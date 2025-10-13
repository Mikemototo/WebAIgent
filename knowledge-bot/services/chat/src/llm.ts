import fetch from "node-fetch";
import { cfg } from "./config.js";

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface ChatCompletion {
  content: string;
  usage: TokenUsage;
}

export async function chatLocal(messages: { role: string; content: string }[]): Promise<ChatCompletion> {
  const resp = await fetch(`${cfg.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.chatModel, messages, stream: false })
  });
  const data = (await resp.json()) as any;
  const prompt = Number(data?.prompt_eval_count ?? 0);
  const completion = Number(data?.eval_count ?? 0);
  const total = prompt + completion;
  const usage: TokenUsage = { prompt, completion, total };
  return {
    content: data?.message?.content || "",
    usage
  };
}

export async function chatGemini(messages: { role: string; content: string }[]): Promise<ChatCompletion> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiChatModel}:generateContent?key=${cfg.geminiKey}`;
  let systemInstruction: { parts: { text: string }[] } | undefined;
  const contents = messages
    .map((message) => {
      if (message.role === "system") {
        systemInstruction = systemInstruction || { parts: [] };
        systemInstruction.parts.push({ text: message.content });
        return null;
      }
      const role = message.role === "assistant" ? "model" : message.role;
      return { role, parts: [{ text: message.content }] };
    })
    .filter((entry): entry is { role: string; parts: { text: string }[] } => entry !== null);

  const payload: Record<string, unknown> = {
    contents,
    generationConfig: { responseMimeType: "text/plain" }
  };
  if (systemInstruction) {
    payload.systemInstruction = systemInstruction;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  const data = (await resp.json()) as any;
  const usageMeta = data?.usageMetadata ?? {};
  const prompt = Number(usageMeta.promptTokenCount ?? 0);
  const completion = Number(usageMeta.candidatesTokenCount ?? 0);
  const total = Number(usageMeta.totalTokenCount ?? prompt + completion);
  const usage: TokenUsage = { prompt, completion, total };
  const responseParts = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [];
  let text = responseParts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter((value: string) => value.trim().length > 0)
    .join("\n\n");
  if (!text && responseParts.length) {
    text = responseParts
      .map((part: any) => {
        if (typeof part?.text === "string") return part.text;
        if (part?.functionCall) return `Function call: ${JSON.stringify(part.functionCall)}`;
        return "";
      })
      .filter((value: string) => value.trim().length > 0)
      .join("\n\n");
  }
  if (!text) {
    console.warn(
      "Gemini returned no textual parts",
      JSON.stringify({ usageMeta, candidates: data?.candidates }, null, 2)
    );
    console.warn("Gemini raw payload", JSON.stringify(data, null, 2));
  }
  return {
    content: text,
    usage
  };
}
