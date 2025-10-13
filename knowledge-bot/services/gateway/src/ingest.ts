import fetch from "node-fetch";
import { htmlToText } from "html-to-text";
import { parse as parseCsv } from "csv-parse/sync";
import { randomUUID } from "crypto";
import cron from "node-cron";
import { crawlLinks } from "./utils/crawl.js";
import { cfg } from "./config.js";
import { getSource, getAllSources, updateIngestStatus, recordHistory, SourceRecord, IngestStatus } from "./state/sourceStore.js";

const QDRANT_URL = cfg.qdrantUrl;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";
const OLLAMA_URL = cfg.ollamaUrl;
const EMBED_MODEL = cfg.embedModel;
const DEFAULT_CHUNK_SIZE = parseInt(process.env.INGEST_CHUNK_SIZE || "1000", 10);
const DEFAULT_CHUNK_OVERLAP = parseInt(process.env.INGEST_CHUNK_OVERLAP || "100", 10);
const DEFAULT_INTERNAL_DEPTH = cfg.defaultInternalCrawlDepth;
const DEFAULT_EXTERNAL_DEPTH = cfg.defaultExternalCrawlDepth;

interface Chunk {
  id: string;
  text: string;
  source: string;
  metadata: Record<string, unknown>;
}

const ingestInFlight = new Map<string, Promise<void>>();

export async function ingestSource(sourceId: string, opts: { reason?: string } = {}): Promise<void> {
  if (ingestInFlight.has(sourceId)) {
    return ingestInFlight.get(sourceId)!;
  }
  const task = runIngest(sourceId, opts).finally(() => {
    ingestInFlight.delete(sourceId);
  });
  ingestInFlight.set(sourceId, task);
  return task;
}

async function runIngest(sourceId: string, opts: { reason?: string }): Promise<void> {
  const source = getSource(sourceId);
  if (!source) {
    return;
  }
  const startedAt = new Date().toISOString();
  await updateIngestStatus(sourceId, "processing", null, { startedAt });
  await recordHistory(sourceId, source.tenantId, "processing", opts.reason);

  try {
    const documents = await collectDocuments(source);
    const chunks = chunkDocuments(documents, source);
    if (!chunks.length) {
      throw new Error("No text could be extracted from the source");
    }
    const points = await embedChunks(chunks, source);
    if (!points.length) {
      throw new Error("Embedding service returned no vectors");
    }
    await ensureCollection(source.tenantId, points[0].vector.length);
    await upsertPoints(source.tenantId, points);

    const completedAt = new Date().toISOString();
    await updateIngestStatus(sourceId, "ready", null, { completedAt });
    await recordHistory(sourceId, source.tenantId, "ready");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateIngestStatus(sourceId, "error", message, { startedAt });
    await recordHistory(sourceId, source.tenantId, "error", message);
    throw error;
  }
}

async function collectDocuments(source: SourceRecord): Promise<Array<{ text: string; source: string }>> {
  switch (source.type) {
    case "url":
      return fetchUrlDocuments(source);
    case "pdf":
      return fetchPdfDocument(source);
    case "text":
      return [{
        text: source.value,
        source:
          source.metadata && typeof (source.metadata as any).source === "string"
            ? ((source.metadata as any).source as string)
            : "manual",
      }];
    case "csv":
      return parseCsvDocument(source);
    default:
      throw new Error(`Unsupported source type: ${source.type}`);
  }
}

async function fetchUrlDocuments(source: SourceRecord) {
  const base = source.value;
  if (!base) {
    throw new Error("No URL provided for ingestion");
  }

  const meta = (source.metadata || {}) as Record<string, unknown>;
  const internalDepth = normalizeDepth(meta.internalCrawlDepth ?? meta.maxInternalLinks ?? DEFAULT_INTERNAL_DEPTH);
  const externalDepth = normalizeDepth(meta.externalCrawlDepth ?? meta.maxExternalLinks ?? DEFAULT_EXTERNAL_DEPTH);

  const docs: Array<{ text: string; source: string }> = [];
  const visited = new Set<string>();

  const enqueue = async (url: string) => {
    if (visited.has(url)) return;
    visited.add(url);
    const raw = await fetchHtmlOrFallback(url);
    const text = htmlToText(raw, {
      wordwrap: 120,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
      ],
    }).trim();
    if (text) {
      docs.push({ text, source: url });
    }
    return raw;
  };

  const initialHtml = await enqueue(base);

  if (initialHtml && (internalDepth !== 0 || externalDepth !== 0)) {
    try {
      const crawlResult = await crawlLinks({
        baseUrl: base,
        html: initialHtml,
        maxInternal: internalDepth,
        maxExternal: externalDepth,
      });
      for (const link of crawlResult.docUrls) {
        await enqueue(link);
      }
    } catch (err) {
      // swallow crawl errors; base document already captured
    }
  }

  return docs;
}

async function fetchPdfDocument(source: SourceRecord) {
  const url = source.value;
  if (!url) throw new Error("PDF URL missing");
  const jinaUrl = `https://r.jina.ai/http/${url}`;
  const res = await fetch(jinaUrl, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Failed to fetch PDF (${res.status})`);
  }
  const text = (await res.text()).trim();
  if (!text) throw new Error("PDF returned no text content");
  return [{ text, source: url }];
}

async function parseCsvDocument(source: SourceRecord) {
  if (!source.value) throw new Error("CSV payload missing");
  const buffer = Buffer.from(source.value, "base64");
  const csvText = buffer.toString("utf8");
  const records = parseCsv(
    csvText,
    {
      relax_column_count: true,
      skip_empty_lines: true,
    } as any
  ) as (string | number | null)[][];
  const lines = records.map((row) => row.map((cell) => (cell === null ? "" : String(cell))).join(", "));
  const text = lines.join("\n");
  if (!text.trim()) {
    throw new Error("CSV produced no rows");
  }
  const sourceLabel = (source.metadata as any)?.filename || "uploaded_csv";
  return [{ text, source: sourceLabel }];
}

async function fetchTextFromUrl(url: string) {
  const res = await fetch(url, {
    method: "GET",
    headers: { "User-Agent": "KnowledgeBot-Ingest/1.0" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch URL (${res.status})`);
  }
  return await res.text();
}

async function fetchHtmlOrFallback(url: string) {
  try {
    return await fetchTextFromUrl(url);
  } catch (primaryError) {
    const jinaUrl = `https://r.jina.ai/http/${url}`;
    const res = await fetch(jinaUrl, { method: "GET" });
    if (!res.ok) {
      throw primaryError;
    }
    return await res.text();
  }
}

function chunkDocuments(docs: Array<{ text: string; source: string }>, source: SourceRecord): Chunk[] {
  const chunks: Chunk[] = [];
  const chunkSize = Number((source.metadata as any)?.chunkSize || DEFAULT_CHUNK_SIZE);
  const overlap = Number((source.metadata as any)?.chunkOverlap || DEFAULT_CHUNK_OVERLAP);
  for (const doc of docs) {
    const clean = doc.text.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    let index = 0;
    while (index < clean.length) {
      const slice = clean.slice(index, index + chunkSize).trim();
      if (slice) {
        chunks.push({
          id: randomUUID(),
          text: slice,
          source: doc.source,
          metadata: source.metadata || {},
        });
      }
      if (index + chunkSize >= clean.length) break;
      index = index + chunkSize - overlap;
    }
  }
  return chunks;
}

async function embedChunks(chunks: Chunk[], source: SourceRecord) {
  const tenantId = source.tenantId;
  const providerRaw = source.embeddingProvider ? String(source.embeddingProvider).toLowerCase() : "";
  const providerPref = providerRaw || cfg.defaultEmbedProvider;
  const provider = providerPref === "cloud" ? "gemini" : providerPref === "local" ? "ollama" : providerPref;
  if (provider !== "ollama" && provider !== "gemini") {
    throw new Error(`Embedding provider ${providerPref || providerRaw || "unknown"} is not supported in ingestion`);
  }
  const points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = [];
  for (const chunk of chunks) {
    const vector = provider === "gemini" ? await embedWithGemini(chunk.text) : await embedWithOllama(chunk.text);
    if (!Array.isArray(vector) || !vector.length) continue;
    points.push({
      id: chunk.id,
      vector,
      payload: {
        tenant_id: tenantId,
        text: chunk.text,
        source: chunk.source,
        ...chunk.metadata,
      },
    });
  }
  return points;
}

async function embedWithOllama(prompt: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt }),
  });
  if (!response.ok) {
    throw new Error(`Embedding request failed (${response.status})`);
  }
  const data: any = await response.json();
  return Array.isArray(data?.embedding) ? data.embedding : [];
}

async function embedWithGemini(text: string): Promise<number[]> {
  if (!cfg.geminiKey) {
    throw new Error("Gemini embeddings require GOOGLE_API_KEY to be set");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiEmbedModel}:embedContent?key=${cfg.geminiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: { parts: [{ text }] } }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Gemini embedding request failed (${response.status}): ${errText}`);
  }
  const data: any = await response.json();
  if (Array.isArray(data?.embedding?.values)) {
    return data.embedding.values;
  }
  if (Array.isArray(data?.data?.[0]?.embedding)) {
    return data.data[0].embedding;
  }
  throw new Error("Gemini embedding response did not include vector values");
}
async function ensureCollection(tenantId: string, vectorSize: number) {
  const body = {
    vectors: {
      size: vectorSize,
      distance: "Cosine",
    },
  };
  const res = await fetch(`${QDRANT_URL}/collections/docs_${tenantId}`, {
    method: "PUT",
    headers: buildQdrantHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 409) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to ensure collection (${res.status}): ${text}`);
  }
}

async function upsertPoints(tenantId: string, points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>) {
  const res = await fetch(`${QDRANT_URL}/collections/docs_${tenantId}/points?wait=true`, {
    method: "PUT",
    headers: buildQdrantHeaders(),
    body: JSON.stringify({ points }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to upsert points (${res.status}): ${text}`);
  }
}

function buildQdrantHeaders() {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (QDRANT_API_KEY) headers["api-key"] = QDRANT_API_KEY;
  return headers;
}

export function scheduleIngestionCron() {
  if (!cfg.ingestCron) return;
  cron.schedule(cfg.ingestCron, async () => {
    const sources = getAllSources();
    for (const source of sources) {
      try {
        await ingestSource(source.id, { reason: "scheduled" });
      } catch (err) {
        // status handling occurs inside ingestSource
      }
    }
  });
}

function normalizeDepth(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return 0;
}
