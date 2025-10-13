import test from "node:test";
import assert from "node:assert/strict";
import nock from "nock";

const { cfg } = await import("../config.js");
const { rerankHits } = await import("../retrieval.js");

nock.disableNetConnect();

test.afterEach(() => {
  nock.cleanAll();
  (cfg as any).useReranker = false;
});

test.after(() => {
  nock.enableNetConnect();
});

test("returns original hits when reranker disabled", async () => {
  (cfg as any).useReranker = false;
  const hits = [{ payload: { text: "A" } }, { payload: { text: "B" } }];
  const result = await rerankHits("query", hits as any);
  assert.equal(result, hits);
});

test("reorders hits when reranker returns ranking", async () => {
  (cfg as any).useReranker = true;
  (cfg as any).rerankerUrl = "http://localhost:19500";

  nock("http://localhost:19500")
    .post("/rerank", { query: "query", passages: ["A", "B", "C"] })
    .reply(200, { order: [2, 0, 1] });

  const hits = [
    { payload: { text: "A" } },
    { payload: { text: "B" } },
    { payload: { text: "C" } }
  ];
  const result = await rerankHits("query", hits as any);
  assert.equal(result[0].payload?.text, "C");
  assert.equal(result[1].payload?.text, "A");
  assert.equal(result[2].payload?.text, "B");
});

