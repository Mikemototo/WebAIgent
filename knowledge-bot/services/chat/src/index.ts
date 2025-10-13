import { cfg } from "./config.js";
import { logger } from "./logger.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(cfg.port, () =>
  logger.info(
    {
      event: "startup",
      port: cfg.port,
      local_model: cfg.chatModel,
      embed_model: cfg.embedModel,
      gemini_model: cfg.geminiChatModel,
      use_reranker: cfg.useReranker,
      use_gemini_safety: cfg.useGeminiSafety,
    },
    "chat listening"
  )
);
