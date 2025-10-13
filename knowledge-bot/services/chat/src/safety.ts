import fetch from "node-fetch";
import { cfg } from "./config.js";

interface ModerationResult {
  blocked: boolean;
  reasons: string[];
}

export async function moderateWithGemini(text: string): Promise<ModerationResult> {
  if (!cfg.useGeminiSafety) {
    return { blocked: false, reasons: [] };
  }
  if (!cfg.geminiKey) {
    console.warn("Gemini safety enabled but GOOGLE_API_KEY is missing");
    return { blocked: false, reasons: [] };
  }
  if (!text.trim()) {
    return { blocked: false, reasons: [] };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiSafetyModel}:moderateText?key=${cfg.geminiKey}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: [{ text }] }),
    });
    if (!res.ok) {
      console.warn("Gemini moderation request failed", res.status, await res.text());
      return { blocked: false, reasons: [] };
    }
    const data: any = await res.json();
    const first = data?.results?.[0];
    if (!first) return { blocked: false, reasons: [] };
    const blocked = Boolean(first.blocked);
    const reasons: string[] = (first?.safetyRatings || [])
      .filter((rating: any) => rating?.probability === "HIGH" || rating?.probability === "VERY_HIGH")
      .map((rating: any) => rating?.category)
      .filter(Boolean);
    return { blocked, reasons };
  } catch (err) {
    console.error("Gemini moderation error", err);
    return { blocked: false, reasons: [] };
  }
}
