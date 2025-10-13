import test from "node:test";
import assert from "node:assert/strict";
import nock from "nock";
import { resolve } from "path";
import { rmSync } from "fs";

const dbPath = resolve(process.cwd(), "test-data", "ingest-test.db");

process.env.SOURCE_DB_PATH = dbPath;
process.env.OLLAMA_BASE_URL = "http://localhost:18000";
process.env.QDRANT_URL = "http://localhost:19000";
process.env.QDRANT_API_KEY = "";
process.env.INGEST_CRON = "";
process.env.EMBED_PROVIDER = "local";
process.env.GOOGLE_API_KEY = "test-key";
process.env.GEMINI_EMBED_MODEL = "text-embedding-004";

const { addSource, getSource } = await import("../state/sourceStore.js");
const { ingestSource } = await import("../ingest.js");

const teardown = () => {
  try {
    rmSync(resolve(process.cwd(), "test-data"), { recursive: true, force: true });
  } catch (err) {
    // ignore
  }
};

nock.disableNetConnect();

test.after(() => {
  teardown();
  nock.enableNetConnect();
});

test.afterEach(() => {
  nock.cleanAll();
});

const tenantId = "TENANT_TEST";

const mockQdrantSuccess = () => {
  nock("http://localhost:19000")
    .put(new RegExp(`/collections/docs_${tenantId}`))
    .reply(200, { result: "ok" })
    .put(new RegExp(`/collections/docs_${tenantId}/points`))
    .query(true)
    .reply(200, { result: { upserted: 1 } });
};

const mockSuccess = () => {
  nock("http://localhost:18000")
    .post("/api/embeddings")
    .times(10)
    .reply(200, { embedding: [0.1, 0.2, 0.3] });

  mockQdrantSuccess();
};

const mockGeminiSuccess = () => {
  const model = process.env.GEMINI_EMBED_MODEL || "text-embedding-004";
  nock("https://generativelanguage.googleapis.com")
    .post(`/v1beta/models/${model}:embedContent`)
    .query(true)
    .times(10)
    .reply(200, { embedding: { values: [0.1, 0.2, 0.3] } });

  mockQdrantSuccess();
};

test("ingest text source updates status to ready", async () => {
  mockSuccess();
  const source = await addSource({
    id: "text-source",
    tenantId,
    type: "text",
    value: "Hello world",
    embeddingProvider: "ollama",
    metadata: {},
    createdAt: new Date().toISOString(),
  });

  await ingestSource(source.id);
  const updated = getSource(source.id);
  assert.ok(updated);
  assert.equal(updated?.ingestStatus, "ready");
  assert.ok(updated?.lastIngestAt);
});

test("ingest handles embedding failure", async () => {
  nock("http://localhost:18000").post("/api/embeddings").reply(500, {});
  const source = await addSource({
    id: "fail-source",
    tenantId,
    type: "text",
    value: "Broken",
    embeddingProvider: "ollama",
    metadata: {},
    createdAt: new Date().toISOString(),
  });

  await assert.rejects(ingestSource(source.id));
  const updated = getSource(source.id);
  assert.ok(updated);
  assert.equal(updated?.ingestStatus, "error");
  assert.ok(updated?.ingestError);
});

test("ingest url source falls back to Jina mirror", async () => {
  mockSuccess();
  nock("http://docs.example").get("/article").reply(500, "nope");
  nock("https://r.jina.ai").get("/http/http://docs.example/article").reply(200, "<html><body>Fallback content</body></html>");

  const source = await addSource({
    id: "url-source",
    tenantId,
    type: "url",
    value: "http://docs.example/article",
    embeddingProvider: "ollama",
    metadata: {},
    createdAt: new Date().toISOString(),
  });

  await ingestSource(source.id);
  const updated = getSource(source.id);
  assert.ok(updated);
  assert.equal(updated?.ingestStatus, "ready");
  assert.ok(!updated?.ingestError);
});

test("ingest gemini provider updates status to ready", async () => {
  mockGeminiSuccess();
  const source = await addSource({
    id: "gemini-source",
    tenantId,
    type: "text",
    value: "Cloud embeddings rule",
    embeddingProvider: "gemini",
    metadata: {},
    createdAt: new Date().toISOString(),
  });

  await ingestSource(source.id);
  const updated = getSource(source.id);
  assert.ok(updated);
  assert.equal(updated?.ingestStatus, "ready");
  assert.ok(updated?.lastIngestAt);
});
