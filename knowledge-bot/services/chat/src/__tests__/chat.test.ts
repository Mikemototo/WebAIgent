import test from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import nock from "nock";
import crypto from "node:crypto";

process.env.OLLAMA_BASE_URL = "http://localhost:18000";
process.env.QDRANT_URL = "http://localhost:19000";
process.env.RERANKER_URL = "http://localhost:19500";
process.env.HMAC_SECRET = "test-secret";
process.env.USE_RERANKER = "false";
process.env.USE_GEMINI_SAFETY = "false";
process.env.GOOGLE_API_KEY = "fake-key";

const { cfg } = await import("../config.js");
const { createApp } = await import("../app.js");

nock.disableNetConnect();

nock.enableNetConnect("127.0.0.1");

const sign = (payload: unknown) =>
  crypto.createHmac("sha256", cfg.hmacSecret).update(JSON.stringify(payload)).digest("hex");

test.afterEach(() => {
  nock.cleanAll();
  (cfg as any).useGeminiSafety = false;
});

test.after(() => {
  nock.enableNetConnect();
});

test("returns fallback when retrieval has no hits", async () => {
  const app = createApp();

  nock("http://localhost:18000")
    .post("/api/embeddings")
    .reply(200, { embedding: [0.1, 0.2, 0.3] });

  nock("http://localhost:19000")
    .post("/collections/docs_TENANT_1/points/search")
    .reply(200, { result: [] });

  const body = { tenant_id: "TENANT_1", question: "What is our policy?", top_k: 3 };
  const response = await supertest(app)
    .post("/chat")
    .set("X-Signature", sign(body))
    .send(body)
    .expect(200);

  assert.equal(
    response.body.answer,
    "I couldn’t find relevant information yet. Try another question or add more sources."
  );
  assert.deepEqual(response.body.citations, []);
});

test("returns grounded answer with hits and metadata", async () => {
  const app = createApp();

  nock("http://localhost:18000")
    .post("/api/embeddings")
    .reply(200, { embedding: [0.1, 0.2, 0.3] })
    .post("/api/chat")
    .reply(200, { message: { content: "Here’s what I found." }, prompt_eval_count: 4, eval_count: 6 });

  nock("http://localhost:19000")
    .post("/collections/docs_TENANT_2/points/search")
    .reply(200, {
      result: [
        {
          payload: {
            title: "Policy",
            url: "http://docs/policy",
            text: "Policy details about remote work and benefits."
          }
        }
      ]
    });

  const body = { tenant_id: "TENANT_2", question: "Tell me about remote work", top_k: 5 };
  const response = await supertest(app)
    .post("/chat")
    .set("X-Signature", sign(body))
    .send(body)
    .expect(200);

  assert.equal(response.body.answer, "Here’s what I found.");
  assert.equal(response.body.metadata.provider, cfg.chatModel);
  assert.equal(response.body.metadata.embeddingProvider, cfg.defaultEmbedProvider);
  assert.equal(response.body.metadata.hitCount, 1);
  assert.equal(response.body.citations.length, 1);
  assert.equal(response.body.citations[0].url, "http://docs/policy");
  assert.deepEqual(response.body.metadata.tokens, { prompt: 4, completion: 6, total: 10 });
});

test("blocks unsafe prompts when Gemini Safety is enabled", async () => {
  (cfg as any).useGeminiSafety = true;
  const app = createApp();

  const moderationScope = nock("https://generativelanguage.googleapis.com")
    .post(/\/v1beta\/models\/.*:moderateText/)
    .reply(200, {
      results: [
        {
          blocked: true,
          safetyRatings: [{ category: "HATE", probability: "HIGH" }]
        }
      ]
    });

  const body = { tenant_id: "TENANT_3", question: "Give me something dangerous" };
  const response = await supertest(app)
    .post("/chat")
    .set("X-Signature", sign(body))
    .send(body)
    .expect(200);

  assert.equal(response.body.answer, "I’m sorry, but I can’t help with that request.");
  assert.deepEqual(response.body.safety, { blocked: true, reasons: ["HATE"] });
  assert.ok(moderationScope.isDone());
});
