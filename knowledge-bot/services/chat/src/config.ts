export const cfg = {
  qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
  qdrantApiKey: process.env.QDRANT_API_KEY || "",
  ollamaUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  chatModel: process.env.CHAT_MODEL || "llama3.1:8b",
  embedModel: process.env.EMBED_MODEL || "nomic-embed-text",
  geminiKey: process.env.GOOGLE_API_KEY || "",
  geminiChatModel: process.env.GEMINI_CHAT_MODEL || "gemini-2.0-flash",
  geminiEmbedModel: process.env.GEMINI_EMBED_MODEL || "text-embedding-004",
  useGeminiSafety: (process.env.USE_GEMINI_SAFETY || "false").toLowerCase() === "true",
  geminiSafetyModel: process.env.GEMINI_SAFETY_MODEL || "text-moderation-latest",
  tenantHeader: process.env.TENANT_HEADER || "X-Tenant-Id",
  hmacHeader: process.env.HMAC_HEADER || "X-Signature",
  hmacSecret: process.env.HMAC_SECRET || "dev_shared_secret",
  rerankerUrl: process.env.RERANKER_URL || "http://reranker:8000",
  useReranker: (process.env.USE_RERANKER || "true").toLowerCase() === "true",
  defaultEmbedProvider: (process.env.EMBED_PROVIDER || "local").toLowerCase() === "cloud" ? "gemini" : "ollama",
  port: 3001
};
