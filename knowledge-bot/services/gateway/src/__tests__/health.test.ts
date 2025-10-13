process.env.GATEWAY_DISABLE_LISTEN = "true";
process.env.GATEWAY_DISABLE_CRON = "true";

import test from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";

async function buildApp() {
  const mod = await import("../index.js");
  return mod.createApp();
}

test("GET /health returns aggregated status", async () => {
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ service: "chat", ok: true }),
  });

  try {
    const app = await buildApp();
    const request = supertest(app);
    const response = await request.get("/health").expect(200);

    assert.equal(response.body.ok, true);
    assert.equal(response.body.service, "gateway");
    assert.equal(response.body.checks.chat.status, "ok");
    assert.equal(response.body.checks.database.status, "ok");
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test("POST /chat without tenant header is rejected", async () => {
  const app = await buildApp();
  const request = supertest(app);
  const response = await request.post("/chat").send({ question: "Hello?" }).expect(400);
  assert.equal(response.body.error, "missing tenant header");
});
