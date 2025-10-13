import { randomUUID } from "crypto";
import { Router } from "express";
import { addSource, listSources, updateSource, removeSource, getSource, ListOptions } from "../state/sourceStore.js";
import { computeAnalytics, fetchHistory, fetchHistorySeries } from "../state/analyticsStore.js";
import { getTenantConfig, upsertTenantConfig } from "../state/tenantConfigStore.js";
import { ingestSource } from "../ingest.js";
import { cfg } from "../config.js";

const router = Router();

const normalizeEmbeddingProvider = (value: unknown): "ollama" | "gemini" => {
  const defaultProvider = cfg.defaultEmbedProvider === "gemini" ? "gemini" : "ollama";
  if (typeof value !== "string") return defaultProvider;
  const normalized = value.toLowerCase();
  if (normalized === "gemini" || normalized === "cloud") return "gemini";
  if (normalized === "local" || normalized === "ollama") return "ollama";
  return defaultProvider;
};

const normalizeDepthValue = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
};

const applyCrawlMetadata = (input: Record<string, unknown>): Record<string, unknown> => {
  const internal = normalizeDepthValue(input.internalCrawlDepth, cfg.defaultInternalCrawlDepth);
  const external = normalizeDepthValue(input.externalCrawlDepth, cfg.defaultExternalCrawlDepth);
  return {
    ...input,
    internalCrawlDepth: internal,
    externalCrawlDepth: external,
  };
};

router.get("/sources", async (req, res) => {
  const tenantId = req.query.tenantId as string | undefined;
  const search = req.query.search as string | undefined;
  const page = Number(req.query.page || "1");
  const pageSize = Math.min(Number(req.query.pageSize || "20"), 100);
  const offset = Math.max(0, (page - 1) * pageSize);

  const options: ListOptions = {
    tenantId,
    search,
    offset,
    limit: pageSize,
  };

  const result = await listSources(options);
  return res.json({
    sources: result.items,
    pagination: {
      page,
      pageSize,
      total: result.total,
      pages: Math.ceil(result.total / pageSize),
    },
  });
});

router.post("/sources", async (req, res) => {
  const { tenantId, type, value, embeddingProvider, metadata } = req.body ?? {};
  if (!tenantId || !type || !value) {
    return res.status(400).json({ error: "tenantId, type, and value are required" });
  }
  const rawMeta = metadata && typeof metadata === "object" ? { ...(metadata as Record<string, unknown>) } : {};
  const meta = applyCrawlMetadata(rawMeta);
  const provider = normalizeEmbeddingProvider(embeddingProvider);

  const record = await addSource({
    id: randomUUID(),
    tenantId,
    type,
    value,
    embeddingProvider: provider,
    metadata: meta,
    createdAt: new Date().toISOString(),
    ingestStatus: "pending",
  });
  try {
    await ingestSource(record.id, { reason: "create" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = getSource(record.id);
    const fallback = updated ?? record;
    return res.status(201).json({ source: fallback, error: message });
  }

  const updated = getSource(record.id) ?? record;
  return res.status(201).json({ source: updated });
});

router.patch("/sources/:id", async (req, res) => {
  const { id } = req.params;
  const { type, value, embeddingProvider, metadata, trigger_ingest } = req.body ?? {};
  if (!type && !value && !embeddingProvider && metadata === undefined && !trigger_ingest) {
    return res.status(400).json({ error: "provide at least one field to update" });
  }
  const meta =
    metadata === undefined
      ? undefined
      : applyCrawlMetadata(
          metadata && typeof metadata === "object"
            ? { ...(metadata as Record<string, unknown>) }
            : {}
        );
  const provider = embeddingProvider === undefined ? undefined : normalizeEmbeddingProvider(embeddingProvider);
  const updated = await updateSource(id, {
    type,
    value,
    embeddingProvider: provider,
    metadata: meta,
  });
  if (!updated) {
    return res.status(404).json({ error: "source not found" });
  }

  const shouldTrigger = Boolean(trigger_ingest || value || type === "text" || type === "csv" || type === "pdf" || type === "url");
  if (shouldTrigger) {
    try {
      await ingestSource(updated.id, { reason: "manual" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const refreshed = getSource(updated.id) ?? updated;
      return res.status(200).json({ source: refreshed, error: message });
    }
  }
  const refreshed = getSource(updated.id) ?? updated;
  return res.json({ source: refreshed });
});

router.delete("/sources/:id", async (req, res) => {
  const { id } = req.params;
  const success = await removeSource(id);
  if (!success) {
    return res.status(404).json({ error: "source not found" });
  }
  return res.status(204).send();
});

router.get("/analytics", async (req, res) => {
  const tenantId = req.query.tenantId as string | undefined;
  try {
    const analytics = await computeAnalytics();
    if (tenantId) {
      const history = fetchHistory(tenantId, Number(req.query.limit) || 20);
      const series = fetchHistorySeries(tenantId, Number(req.query.days) || 14);
      return res.json({ analytics: analytics.filter((row) => row.tenantId === tenantId), history, series });
    }
    return res.json({ analytics });
  } catch (err) {
    console.error("Failed to compute analytics", err);
    return res.status(500).json({ error: "failed to compute analytics" });
  }
});

router.get("/config", (req, res) => {
  const tenantId = req.query.tenantId as string;
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
  return res.json({ config: getTenantConfig(tenantId) });
});

router.put("/config", (req, res) => {
  const { tenantId, allowKeywords = [], denyKeywords = [], contextLimit } = req.body ?? {};
  if (!tenantId) return res.status(400).json({ error: "tenantId required" });
  if (!Array.isArray(allowKeywords) || !Array.isArray(denyKeywords)) {
    return res.status(400).json({ error: "allowKeywords and denyKeywords must be arrays" });
  }
  const config = {
    tenantId,
    allowKeywords,
    denyKeywords,
    contextLimit: contextLimit !== undefined ? Number(contextLimit) : undefined,
  };
  upsertTenantConfig(config);
  return res.json({ config });
});

export default router;
