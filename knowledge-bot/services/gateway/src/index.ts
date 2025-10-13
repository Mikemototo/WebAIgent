import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { cfg } from "./config.js";
import health from "./routes/health.js";
import { requireTenant } from "./middleware/auth.js";
import chat from "./routes/chat.js";
import adminRoutes from "./routes/admin.js";
import { requireAdminToken } from "./middleware/adminAuth.js";
import { logger, requestSerializer, responseSerializer } from "./utils/logger.js";
import { scheduleIngestionCron } from "./ingest.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: "2mb" }));
  const corsOrigins =
    cfg.corsOrigins.trim().length === 0
      ? true
      : cfg.corsOrigins.split(",").map((origin) => origin.trim()).filter(Boolean);
  app.use(
    cors({
      origin: corsOrigins,
      credentials: false,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", cfg.tenantHeader, cfg.hmacHeader, "X-Admin-Token", "Authorization"],
    })
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: true,
      serializers: {
        req: requestSerializer,
        res: responseSerializer,
      },
      customLogLevel: function customLogLevel(req, res, err) {
        if (res.statusCode >= 500 || err) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    })
  );

  app.use("/health", health);
  app.use("/chat", requireTenant, chat);
  app.use("/admin", requireAdminToken, adminRoutes);

  return app;
}

const app = createApp();

if (cfg.ingestCron && process.env.GATEWAY_DISABLE_CRON !== "true") {
  scheduleIngestionCron();
  logger.info({ event: "ingest.cron", cron: cfg.ingestCron }, "scheduled ingestion cron");
}

if (process.env.GATEWAY_DISABLE_LISTEN !== "true") {
  app.listen(cfg.port, () => logger.info({ event: "startup", port: cfg.port }, "gateway listening"));
}

export default app;
