import fetch from "node-fetch";
import { cfg } from "./config.js";

export async function searchQdrant(collection: string, vector: number[], topK = 5) {
  const resp = await fetch(`${cfg.qdrantUrl}/collections/${collection}/points/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cfg.qdrantApiKey ? { "api-key": cfg.qdrantApiKey } : {}) },
    body: JSON.stringify({
      limit: topK,
      vector,
      with_payload: true
    })
  });
  const data = (await resp.json()) as any;
  return data?.result || [];
}

export async function rerankHits(query: string, hits: any[]) {
  if (!cfg.useReranker || !cfg.rerankerUrl) return hits;
  const passages = hits.map((hit: any) => hit?.payload?.text ?? "");
  if (!passages.some((text: string) => text && text.trim().length > 0)) {
    return hits;
  }
  try {
    const res = await fetch(`${cfg.rerankerUrl}/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, passages }),
    });
    if (!res.ok) return hits;
    const data = (await res.json()) as any;
    const order: number[] = Array.isArray(data?.order) ? data.order : [];
    if (!order.length) return hits;
    const reordered = order
      .map((index) => hits[index])
      .filter((hit) => hit !== undefined);
    return reordered.length ? reordered : hits;
  } catch (err) {
    console.error("rerank request failed", err);
    return hits;
  }
}
