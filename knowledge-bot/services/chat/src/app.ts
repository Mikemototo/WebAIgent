import express from "express";
import pinoHttp from "pino-http";
import crypto from "crypto";
import { v4 as uuid } from "uuid";
import { cfg } from "./config.js";
import { embedLocal, embedGemini } from "./embeddings.js";
import { searchQdrant, rerankHits } from "./retrieval.js";
import { chatLocal, chatGemini } from "./llm.js";
import { moderateWithGemini } from "./safety.js";
import { evaluateGuardrails, TenantGuardrailConfig } from "./guardrails.js";
import { buildContext } from "./context.js";
import { logger } from "./logger.js";

function verifyHmac(req: express.Request, body: string) {
  const sig = req.header(cfg.hmacHeader);
  const calc = crypto.createHmac("sha256", cfg.hmacSecret).update(body).digest("hex");
  return sig === calc;
}

function resolveTenantGuardrails(input: unknown): TenantGuardrailConfig {
  if (!input || typeof input !== "object") return {};
  const allow = Array.isArray((input as any).allowKeywords)
    ? (input as any).allowKeywords.map((v: unknown) => String(v))
    : [];
  const deny = Array.isArray((input as any).denyKeywords)
    ? (input as any).denyKeywords.map((v: unknown) => String(v))
    : [];
  const limit =
    typeof (input as any).contextLimit === "number" &&
    Number.isFinite((input as any).contextLimit) &&
    (input as any).contextLimit > 0
      ? (input as any).contextLimit
      : undefined;
  return {
    allowKeywords: allow,
    denyKeywords: deny,
    contextLimit: limit,
  };
}

export function createApp() {
  const app = express();
  const startedAt = Date.now();

  app.use(express.json({ limit: "2mb" }));
  app.use(
    pinoHttp({
      logger,
      genReqId: function genReqId(req) {
        if (req.headers["x-request-id"]) return String(req.headers["x-request-id"]);
        return uuid();
      },
      customProps: function customProps(req, res) {
        const tokens = (res as any).locals?.responseTokens;
        return {
          tenant:
            (req as any).tenantId ||
            (req.body && typeof req.body === "object" ? (req.body as any).tenant_id : undefined),
          tokens_total: tokens?.total,
          tokens_prompt: tokens?.prompt,
          tokens_completion: tokens?.completion,
        };
      },
      customLogLevel: function customLogLevel(_req, res, err) {
        if (res.statusCode >= 500 || err) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    })
  );

  app.get("/health", (_req, res) =>
    res.json({
      ok: true,
      service: "chat",
      uptime_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      config: {
        useGeminiSafety: cfg.useGeminiSafety,
        useReranker: cfg.useReranker,
      },
    })
  );

  app.post("/moderate", async (req, res) => {
    const raw = JSON.stringify(req.body || {});
    if (!verifyHmac(req, raw)) {
      logger.warn({ event: "moderate.reject", reason: "bad_signature" }, "moderation rejected due to bad signature");
      return res.status(401).json({ error: "bad signature" });
    }
    const text = (req.body as any)?.text;
    if (!text || typeof text !== "string") {
      logger.warn({ event: "moderate.reject", reason: "missing_text" }, "moderation rejected due to missing text");
      return res.status(400).json({ error: "text is required" });
    }
    const result = await moderateWithGemini(text);
    logger.info({ event: "moderate.result", blocked: result.blocked, reasons: result.reasons }, "moderation completed");
    return res.json(result);
  });

  app.post("/chat", async (req, res) => {
    const started = Date.now();
    const raw = JSON.stringify(req.body);
    if (!verifyHmac(req, raw)) {
      logger.warn({ event: "chat.reject", reason: "bad_signature" }, "chat rejected due to bad signature");
      return res.status(401).json({ error: "bad signature" });
    }

    const { tenant_id, question, top_k = 5, use = "local", tenant_config, embedding_provider } = req.body as any;
    if (!tenant_id || !question) {
      logger.warn({ event: "chat.reject", reason: "missing_fields" }, "chat rejected missing tenant_id/question");
      return res.status(400).json({ error: "tenant_id and question required" });
    }

    const tenantGuardrails = resolveTenantGuardrails(tenant_config);
    logger.info(
      { event: "chat.received", tenant: tenant_id, top_k, use, guardrails: tenantGuardrails },
      "chat request received"
    );

    if (cfg.useGeminiSafety) {
      const { blocked, reasons } = await moderateWithGemini(question);
      if (blocked) {
        logger.warn({ event: "chat.blocked", reason: "gemini_safety", reasons }, "gemini safety blocked question");
        return res.json({
          answer: "I’m sorry, but I can’t help with that request.",
          citations: [],
          safety: { blocked: true, reasons },
        });
      }
    }

    const guardrailDecision = evaluateGuardrails(question, tenantGuardrails);
    if (guardrailDecision.blocked) {
      logger.warn(
        { event: "chat.blocked", reason: guardrailDecision.reason ?? "guardrail", tenant: tenant_id },
        "tenant guardrail blocked question"
      );
      return res.json({
        answer:
          guardrailDecision.message ||
          "I’m sorry, but I can’t help with that request. Please reach out to a trusted administrator.",
        citations: [],
        safety: guardrailDecision.reason ? { blocked: true, reasons: [guardrailDecision.reason] } : undefined,
      });
    }

    const embedStarted = Date.now();
    const embedSelectionRaw = typeof embedding_provider === "string" ? embedding_provider.toLowerCase() : undefined;
    const chosenEmbedProvider = embedSelectionRaw || cfg.defaultEmbedProvider;
    const normalizedEmbedProvider = chosenEmbedProvider === "cloud" ? "gemini" : chosenEmbedProvider;
    const qVec = normalizedEmbedProvider === "gemini" ? await embedGemini(question) : (await embedLocal([question]))[0];
    const embedMs = Date.now() - embedStarted;

    const collection = `docs_${tenant_id}`;
    const searchStarted = Date.now();
    let hits = await searchQdrant(collection, qVec, top_k);
    const searchMs = Date.now() - searchStarted;

    if (!hits.length) {
      logger.info({ event: "chat.miss", tenant: tenant_id }, "no documents found for query");
      return res.json({
        answer: "I couldn’t find relevant information yet. Try another question or add more sources.",
        citations: [],
      });
    }

    const rerankStarted = Date.now();
    hits = await rerankHits(question, hits);
    const rerankMs = Date.now() - rerankStarted;

    const context = buildContext(hits, tenantGuardrails.contextLimit ?? undefined);

    if (!context) {
      logger.warn({ event: "chat.context_empty", tenant: tenant_id }, "no context assembled after guardrails");
      return res.json({
        answer: "I couldn’t assemble enough context yet. Try another question or add more sources.",
        citations: [],
      });
    }

    const system = "Answer strictly from the provided context. If unsure, say you don't know and suggest where to look.";
    const prompt = `Context:\n${context}\n\nQuestion: ${question}\nAnswer:`;
    const msgs = [{ role: "system", content: system }, { role: "user", content: prompt }];

    const llmStarted = Date.now();
    const completion = use === "gemini" ? await chatGemini(msgs) : await chatLocal(msgs);
    const llmMs = Date.now() - llmStarted;
    const safeAnswer = completion.content?.trim() ? completion.content.trim() : "I’m not certain how to answer that yet.";
    const citations = hits.slice(0, 3).map((h: any) => ({ title: h.payload?.title, url: h.payload?.url }));
    const totalMs = Date.now() - started;
    const provider = use === "gemini" ? cfg.geminiChatModel : cfg.chatModel;
    const tokens = completion.usage || { prompt: 0, completion: 0, total: 0 };
    const metadata = {
      provider,
      embeddingProvider: normalizedEmbedProvider,
      embeddingsMs: embedMs,
      searchMs,
      rerankMs,
      llmMs,
      totalMs,
      hitCount: hits.length,
      citations,
      tokens,
    };
    logger.info(
      {
        event: "chat.completed",
        tenant: tenant_id,
        mode: use,
        provider,
        embed_provider: normalizedEmbedProvider,
        elapsed_ms: totalMs,
        embeddings_ms: embedMs,
        search_ms: searchMs,
        rerank_ms: rerankMs,
        llm_ms: llmMs,
        hitCount: hits.length,
        tokens_prompt: tokens.prompt,
        tokens_completion: tokens.completion,
        tokens_total: tokens.total,
      },
      "chat request completed"
    );
    (res as any).locals = (res as any).locals || {};
    (res as any).locals.responseTokens = tokens;
    return res.json({ answer: safeAnswer, citations, metadata });
  });

  return app;
}
