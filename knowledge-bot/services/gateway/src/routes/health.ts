import { Router } from "express";
import fetch from "node-fetch";
import { cfg } from "../config.js";
import { db } from "../db.js";
import { logger } from "../utils/logger.js";

const router = Router();
const startedAt = Date.now();

type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
}>;

function getFetch(): FetchLike {
  if ((globalThis as any).fetch) {
    return (globalThis as any).fetch.bind(globalThis) as FetchLike;
  }
  return fetch as unknown as FetchLike;
}

function checkDatabase() {
  try {
    db.prepare("SELECT 1").get();
    return { status: "ok" as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    logger.error({ event: "health.db_error", message }, "database health check failed");
    return { status: "fail" as const, error: message };
  }
}

async function checkChat() {
  const started = Date.now();
  try {
    const res = await getFetch()(new URL("/health", cfg.chatUrl).toString(), {
      method: "GET",
      headers: { "x-health-check": "gateway" },
    });
    if (!res.ok) {
      logger.warn({ event: "health.chat_bad_status", status: res.status }, "chat health returned non-200");
      return { status: "fail" as const, httpStatus: res.status };
    }
    const body = await res.json().catch(() => ({}));
    return { status: "ok" as const, latency_ms: Date.now() - started, details: body };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    logger.error({ event: "health.chat_error", message }, "chat health check failed");
    return { status: "fail" as const, error: message };
  }
}

router.get("/", async (_req, res) => {
  const [chat, database] = await Promise.all([checkChat(), Promise.resolve(checkDatabase())]);
  const checks = {
    chat,
    database,
  };
  const ok = Object.values(checks).every((check) => check.status === "ok");
  res.json({
    ok,
    service: "gateway",
    uptime_ms: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
    checks,
  });
});

export default router;
