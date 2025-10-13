import { Router } from "express";
import fetch from "node-fetch";
import { cfg } from "../config.js";
import { hmacSign } from "../utils/hmac.js";
import { getTenantConfig } from "../state/tenantConfigStore.js";
import { logger } from "../utils/logger.js";

const r = Router();

r.post("/", async (req, res) => {
  const tenantId = (req as any).tenantId as string;
  const tenantConfig = getTenantConfig(tenantId);
  const payload = { ...req.body, tenant_id: tenantId, tenant_config: tenantConfig };
  if (!payload.use) {
    payload.use = cfg.chatProviderMode === "cloud" ? "gemini" : "local";
  }
  const body = JSON.stringify(payload);
  const sig = hmacSign(cfg.hmacSecret, body);
  const started = Date.now();
  try {
    const resp = await fetch(`${cfg.chatUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [cfg.hmacHeader]: sig },
      body,
    });

    const data = (await resp.json()) as any;
    const elapsed = Date.now() - started;
    logger.info(
      {
        event: "gateway.chat",
        tenant: tenantId,
        elapsed_ms: elapsed,
        status: resp.status,
        hitCount: data?.metadata?.hitCount,
        provider: data?.metadata?.provider,
        tokens_total: data?.metadata?.tokens?.total,
        tokens_prompt: data?.metadata?.tokens?.prompt,
        tokens_completion: data?.metadata?.tokens?.completion,
      },
      "forwarded chat request"
    );
    return res.status(resp.status).json(data);
  } catch (err) {
    const elapsed = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ event: "gateway.chat_error", tenant: tenantId, elapsed_ms: elapsed, error: message }, "chat request failed");
    return res.status(502).json({ error: "chat service unavailable" });
  }
});

export default r;
