import fetch from "node-fetch";
import { cfg } from "./config.js";

export async function embedLocal(texts: string[]): Promise<number[][]> {
  const resp = await fetch(`${cfg.ollamaUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.embedModel, prompt: texts.join("\n\n") })
  });
  const data = (await resp.json()) as any;
  // Ollama returns one vector for the whole prompt; for simplicity do per-call single text
  return [data.embedding];
}

export async function embedGemini(text: string): Promise<number[]> {
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiEmbedModel}:embedContent?key=${cfg.geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: { parts: [{ text }] } })
  });
  const data = (await resp.json()) as any;
  return data.embedding?.values || [];
}
