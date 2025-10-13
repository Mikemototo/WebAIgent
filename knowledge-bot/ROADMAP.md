# Knowledge Bot Roadmap

## Current Status
- ✅ Local stack (gateway, chat, Qdrant, Ollama) runs via `docker compose`.
- ✅ Native ingestion flow (URL/PDF/Text/CSV) populates Qdrant collections with immediate indexing.
- ✅ Chat endpoint returns answers and citations from Qdrant with guardrails and fallbacks.
- ✅ Widget polished with loading/error states, history, and citations.

## Remaining Milestones

### 1. Widget Ready for Production
- ✅ Add optional theming/config (colors, position, max height).
- ✅ Add configurability for CDN bundle + embed snippet documentation.
- ✅ Bundle & minify for CDN delivery; document embed snippet for websites.
- ✅ Provide local demo page and instructions for integrators.

### 2. Admin Web Interface for Source Management
- ✅ Add crawl-depth controls (internal vs external) per source; integrate recursive fetch pipeline.
- ✅ Persist source metadata outside gateway memory (JSON store by default; upgrade to DB pending).
- ✅ Extend admin SPA: tenant overview, source CRUD, manual ingest trigger, execution timeline.
- ✅ Add delete/edit endpoints + refresh trigger in admin API.
- ✅ Add analytics view (doc counts, execution history chart) and DB persistence.
- ✅ Streamline source creation to URL/PDF/Text inputs for demo.
- ✅ Add CSV upload UX (drag/drop or file picker) and display processing progress.
- ✅ Display per-source ingest status (in progress / last run / errors) and allow manual refresh.

### 3. Guardrailed Responses & Backend Enhancements
- ✅ Integrate Gemini Safety moderation (`USE_GEMINI_SAFETY`) for ingest + chat.
- ✅ Expand guardrails (context limiter, moderation, allow/deny lists).
- ✅ Integrate reranker service in retrieval pipeline (use `services/reranker`).
- ✅ Observability: structured logs + tracing; aggregated health endpoint.
- ✅ Native ingestion pipeline (removed n8n dependency; gateway embeds & upserts directly).
- ✅ Unit/integration tests across ingestion, retrieval, responses.

### 4. Operational Hardening
- CI pipeline to lint/build services & validate workflows.
- Remove n8n services and simplify Docker Compose footprint.
- Backup/restore strategy for Qdrant data & SQLite source store.
- Documentation refresh (README, admin guide, widget integration guide).
- Track admin UI dependencies (`npm audit`) and bump before release.

## Immediate Todo List
- ✅ Add structured logging + request tracing for gateway/chat; surface aggregated health endpoint.
- ✅ Provide demo seeding script and smoke test to validate chat responses.
- ✅ Native ingestion service (URL/PDF/Text), CSV upload + progress UI, daily refresh scheduling in gateway.
- Stand up CI workflow to lint/build/test services (gateway/chat + smoke) and enforce formatting.
- Document backup/restore steps for Qdrant data; update README/admin guide/widget docs.
- Run `npm audit` across admin/chat/gateway services and bump critical deps before release.
- Evaluate headless crawler (Playwright + link depth controls) to support JS-heavy sites.
- Implement end-to-end monitoring (request tracing, retrieval/LLM choice logging, latency metrics).

## Notes
- Keep using signed webhooks for cross-service trust.
- Centralize secrets (`.env`) across services and keep ingestion/auth tokens aligned.
- Consider adding automated model pulling & health-check targets in Makefile.
