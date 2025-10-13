# Knowledge Bot (Local-First RAG Stack)

Local-first Retrieval-Augmented Generation stack with Ollama + Qdrant, a native ingestion worker, optional Gemini fallback, and a minimal embeddable chat widget.

## System Overview

- **Core services**
  - `services/gateway`: edge API that exposes chat/admin endpoints, owns HMAC validation, and runs the ingestion scheduler/worker.
  - `services/chat`: stateless responder that embeds questions, queries Qdrant, reranks, enforces guardrails, and calls Ollama or Gemini.
  - `services/reranker`: optional GPU-assisted reranker that refines retrieval ordering when `USE_RERANKER=true`.
  - `services/admin`: Vite/React SPA for tenant/source management and analytics, backed entirely by the gateway API.
- **Vector + model dependencies**
  - **Qdrant** stores per-tenant document collections (`docs_<TENANT_ID>`) plus ingest telemetry.
  - **Ollama** serves embedding + chat models for local-first operation.
  - Set `MODEL=cloud` to default answers to Gemini (`GOOGLE_API_KEY` required).
  - Set `EMBED_PROVIDER=cloud` to use Gemini embeddings (re-ingest sources so vectors move to the Gemini space).
- **Ingestion flow**
  1. Admin/API creates or updates a source record (URL, PDF, CSV, or raw text).
  2. Gateway’s native worker fetches content, moderates (optional Gemini safety), chunks, embeds with the selected provider (Ollama by default, Gemini when `EMBED_PROVIDER=cloud`), and upserts vectors into Qdrant.
  3. Status and history are persisted in SQLite (`services/gateway/src/state/sourceStore`), powering admin analytics.
  4. Cron (`INGEST_CRON`) can replay the worker for scheduled refreshes.
- **Retrieval & response**
  1. Clients call `POST /chat` on the gateway with HMAC-signed payloads and tenant headers.
  2. Gateway forwards to the chat service after guardrail pre-checks.
  3. Chat embeds the query, searches Qdrant, optionally reranks, trims context per tenant policy, then generates with Ollama (default) or Gemini.
  4. Responses include citations, latency breakdowns, and guardrail metadata; structured logs capture the full trace with `x-request-id`.
- **Guardrails & safety**
  - Tenant-scoped allow/deny keyword lists and context limits.
  - Gemini Safety moderation (when enabled) on both ingestion documents and live chat prompts.
  - Empty retrievals return a guided fallback to avoid hallucinations.
- **Observability**
  - Pino JSON logs across gateway/chat with pretty mode locally.
  - `/health` endpoints aggregate dependency checks, timings, and guardrail toggles.
  - Ingest history persists for visualization in the admin dashboard.
- **Integration surfaces**
  - Admin SPA for tenant/source CRUD and analytics.
  - Embeddable widget (`widget/`) for drop-in chat UX.
  - Scripts for seeding demo content (`scripts/seed-demo.sh`) and smoke testing (`make smoke`).

## Requirements

- Docker + Docker Compose (with NVIDIA Container Toolkit for GPU access)
- Node.js 20+, npm, and Python 3.11+ (for local development builds/tests)
- 16 GB VRAM GPU recommended for Ollama models
- Optional: Google API key for Gemini fallback (`GOOGLE_API_KEY`)

## Setup

1. Copy environment template and adjust values:
   ```bash
   cd knowledge-bot
   cp .env.example .env
   # edit .env to set JWT_PUBLIC_KEY, GOOGLE_API_KEY, ADMIN_API_TOKEN, MODEL (local|cloud), EMBED_PROVIDER (local|cloud), etc.
   ```
2. Build and start the stack:
   ```bash
   make up
   ```
3. Pull Ollama models (runs against the Ollama container or localhost):
   ```bash
   make pull-models
   ```
4. Smoke test core services once containers are ready:
   ```bash
   make check
   ```

### Service Lifecycle

- Stop everything and remove containers/volumes:
  ```bash
  make down
  ```
- Start (or rebuild) the full stack in detached mode:
  ```bash
  make up
  ```
- Restart from a clean slate (stop, rebuild, start):
  ```bash
  make down && make up
  ```
  > Use this whenever you edit `.env` or change code so containers are recreated with the new configuration.
  > Prefer `docker compose -f docker-compose.local.yml restart` only when you want to bounce running containers **without** changing env/config.

## Ingestion & Admin Portal

- Start the stack (`make up`) and open the admin UI at http://localhost:3030.
- Authenticate with the token configured in `.env` (`ADMIN_API_TOKEN`).
- Add sources per tenant:
  - **URL** – fetches and cleans the page body.
  - **PDF URL** – retrieves text via `https://r.jina.ai`.
  - **Text** – paste raw content.
  - **CSV** – backend ingestion supported; use the API/seed script while the admin upload UX lands.
  - Pick **Embedding Provider** (Ollama ↔ Gemini). Switch to Gemini once `EMBED_PROVIDER=cloud` is set and documents have been re-ingested with the cloud embeddings.
  - Set `VITE_DEFAULT_EMBED_PROVIDER=cloud` in `.env` if you want the admin form to default to Gemini.
  - Control crawl depth defaults via `CRAWL_INTERNAL_DEPTH` / `CRAWL_EXTERNAL_DEPTH` (gateway) and mirror them in the admin UI with `VITE_DEFAULT_INTERNAL_CRAWL_DEPTH` / `VITE_DEFAULT_EXTERNAL_CRAWL_DEPTH`.
  - Per source you can now set **Internal crawl depth** and **External crawl depth** (−1 = crawl all, 0 = none, positive integers = depth limit).
  - CSV uploads support drag & drop with live progress, and the Sources table now shows status badges plus a **Refresh status** shortcut for quick polling.
- Each source ingests immediately. Status chips (and badges) track **Processing → Ready** (or **Error** with details). Use **Refresh status** or **Re-ingest** to poll or rerun ingestion on demand.
- The gateway runs a daily refresh cron (default `INGEST_CRON=0 2 * * *`); adjust or disable in `.env` as needed.
- Analytics cards display document counts and ingest history pulled from Qdrant.

## Chat Gateway

- Gateway (`services/gateway`) exposes `POST /chat` and relays to the chat service.
- Every request must include `X-Tenant-Id` (configurable via `.env`) and is HMAC-signed between services using `HMAC_SECRET`.
- Default provider is set via `MODEL` (`local` uses Ollama, `cloud` uses Gemini) for generation; clients can still override per-request by sending `{"use":"local"|"gemini"}`.
- Retrieval embeddings default to `EMBED_PROVIDER` (`local` keeps them in the Ollama space used during ingestion). Only switch both ingestion + chat to `cloud` once you re-embed documents with Gemini.
- Guardrails: sensitive keywords receive a safe refusal, and empty retrievals return a helpful fallback. Responses default to Ollama unless overridden.

### Example Query

```bash
curl -X POST http://localhost:8787/chat \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Id: TENANT_123' \
  -d '{"question":"Do you ship internationally?","top_k":5}'
```
Response includes `answer`, `citations`, and a `metadata` block detailing provider, hit count, and latency breakdowns.

## Guardrails & Safety

- The chat service can call Gemini Safety (`USE_GEMINI_SAFETY=true`) to moderate prompts before reaching the LLM.
- Additional keyword guardrails block obvious sensitive phrases (e.g. credentials, SSNs).
- When retrieval yields no context, the response explains that no content is available yet.
- Ingestion workflows call the chat `/moderate` endpoint to skip unsafe documents automatically.
- Responses are trimmed to avoid empty strings and can be extended with additional moderation services as needed.

## Widget

- `widget/widget.js` now includes loading/error states, inline history, citation rendering, and runtime theming. Configure globals before loading:
  ```html
  <script>
    window.__BOT_API__ = "http://localhost:8787/chat";
    window.__BOT_TENANT__ = "TENANT_123";
    window.__BOT_OPTIONS__ = {
      title: "Knowledge Bot",
      position: "bottom-right",
      accentColor: "#4f46e5",
      maxHeight: 260,
      width: 340,
      placeholder: "Try “How do I request PTO?”"
    };
  </script>
  <script src="/path/to/widget.js"></script>
  ```
- Available `window.__BOT_OPTIONS__` keys:
  - `title`, `placeholder`, `inputLabel`
  - `position` (`bottom-right`, `bottom-left`, `top-right`, `top-left`)
  - `width`, `maxHeight`, `offset`, `offsetX`, `offsetY`, `zIndex`, `maxHistory`
  - Theme tokens: `accentColor`, `backgroundColor`, `borderColor`, `textColor`, `mutedColor`, `logBackgroundColor`, `inputBackgroundColor`, `errorColor`, `successColor`, `borderRadius`, `inputRadius`, `boxShadow`, `fontFamily`
- Suggested production bundle (from repo root):
  ```bash
  npm run build-widget
  ```
  Or directly:
  ```bash
  npx esbuild widget/widget.js --bundle --minify --format=iife --global-name=KnowledgeBotWidget --outfile=dist/widget.bundle.js
  ```
  The bundle is written to `dist/widget.bundle.js`; serve via CDN or static hosting and embed with `<script src="...">`.
- `widget/demo.html` provides a ready-to-run local preview page that mounts the widget with sample options.
- The widget performs signed gateway calls using only tenant headers; the gateway handles downstream HMAC signing.

## Admin Portal

- Configure admin auth in `.env` (`ADMIN_API_TOKEN` for header mode, or `ADMIN_AUTH_MODE=jwt` with `ADMIN_JWT_SECRET` or `ADMIN_JWT_PUBLIC_JWK`, plus optional issuer/audience).
- Run the portal:
  ```bash
  docker compose -f docker-compose.local.yml up admin
  ```
  Access http://localhost:3030 to manage sources.
- Connection panel supports token or JWT bearer modes; data persists to SQLite (`SOURCE_DB_PATH`, default `./data/sources.db`). Analytics cards now include doc counts, ingest history, and a rolling ingest timeline per tenant.
- Admin API endpoints:
  - `GET /admin/sources?tenantId=...&page=1&pageSize=20&search=...` – list with pagination/search.
  - `POST /admin/sources` – create + trigger ingest.
  - `PATCH /admin/sources/:id` – update fields (optional `trigger_ingest`).
  - `DELETE /admin/sources/:id` – remove a source.
  - `GET /admin/analytics` – aggregated tenant stats (source counts, last ingest, Qdrant doc count).

### Admin API Examples

```bash
# List sources for a tenant (page 1)
curl -s \
  -H 'X-Admin-Token: $ADMIN_API_TOKEN' \
  'http://localhost:8787/admin/sources?tenantId=TENANT_123&page=1&pageSize=20' | jq

# Trigger a manual re-ingest
curl -s -X PATCH \
  -H 'Content-Type: application/json' \
  -H 'X-Admin-Token: $ADMIN_API_TOKEN' \
  -d '{"trigger_ingest":true}' \
  http://localhost:8787/admin/sources/<SOURCE_ID>

# Fetch analytics + recent history for a tenant
curl -s \
  -H 'X-Admin-Token: $ADMIN_API_TOKEN' \
  'http://localhost:8787/admin/analytics?tenantId=TENANT_123&limit=10' | jq
```

## Observability

- Gateway and chat emit structured JSON logs via Pino; set `LOG_LEVEL` (default `info`) in `.env` to change verbosity. Logs include token usage totals for each completed chat. Pretty output is enabled automatically in non-production environments.
- Every request receives an `x-request-id` (propagated from incoming headers when present); include it in support tickets to correlate gateway/chat logs.
- Gateway `/health` now aggregates dependency checks and uptime:
  ```bash
  curl -s http://localhost:8787/health | jq
  ```
  The response includes chat latency, database status, and timestamps suitable for dashboards.
- Chat service mirrors the pattern at `http://localhost:3001/health`, exposing uptime and active guardrail toggles for quick verification.
- Chat flow emits structured logs (`chat.received`, `chat.completed`, `gateway.chat`) with provider, hit count, and latency breakdowns. Tail them via:
  ```bash
  docker compose -f docker-compose.local.yml logs -f gateway chat
  ```
- If you rotate `HMAC_SECRET`, update `.env` and restart the gateway so signature verification stays aligned.

## Demo Workflow

1. Start the stack: `make up`
2. Pull Ollama models (first run only, uses the exposed host port):
   ```bash
   make pull-models
   ```
3. Seed demo knowledge (creates a sample document for `TENANT_DEMO`):
   ```bash
   OLLAMA_BASE_URL=http://localhost:11435 TENANT_ID=TENANT_DEMO bash scripts/seed-demo.sh
   ```
4. Run the smoke test to confirm retrieval end-to-end:
   ```bash
   TENANT_ID=TENANT_DEMO make smoke
   ```
   The script checks gateway/chat health endpoints and verifies the chat answer references the seeded document.
   - If you prefer to keep the chat service internal, set `CHAT_URL=http://localhost:8787 TENANT_ID=TENANT_DEMO make smoke` so the script talks through the gateway.
5. Serve the widget (`python3 -m http.server 8000`) and open http://localhost:8000/widget/demo.html. The admin UI lives at http://localhost:3030 (token from `.env`). Ask “What is Knowledge Bot?” to verify the seeded content. Update `window.__BOT_TENANT__` if you change the tenant.
   - If you host the widget from another origin, add that origin to `CORS_ORIGINS` in `.env` (defaults to `http://localhost:8000,http://localhost:3030`).

### Troubleshooting

- **Embedding 404s**: When running via Docker Compose, the Ollama container is mapped to host port `11435`; set `OLLAMA_BASE_URL=http://localhost:11435` for CLI calls (already shown above).
- **Smoke test can’t reach chat**: Either expose `3001:3001` for the chat service or pass `CHAT_URL=http://localhost:8787` so the smoke script goes through the gateway.
- **Widget says “couldn’t reach the knowledge service”**: Ensure the page is loaded from a host listed in `CORS_ORIGINS` and that the seeded tenant matches `window.__BOT_TENANT__`.

## Development Notes

- TypeScript services build to `dist/` via `npm run build` in each service directory.
- `npm run test` inside `services/gateway` and `services/chat` runs unit tests; `make smoke` executes a lightweight gateway/chat health check for CI pipelines.
- `scripts/dev-check.sh` depends on `jq` for JSON display; install if missing.
- Adjust Docker Compose volumes if persisting data outside the repo.
- Use `make down` to tear down and clear local state volumes.

## Acceptance Checklist

- Containers healthy via `docker compose ps` and `make check`.
- Ollama models pulled and responding on `http://localhost:11435`.
- Qdrant has per-tenant collections named `docs_<TENANT_ID>`.
- Admin portal reachable on http://localhost:3030 with valid `ADMIN_API_TOKEN`; sources ingest successfully and persist to `SOURCE_DB_PATH`.
- Widget embedded in a static page successfully calls the gateway.
- Gemini requests succeed when `use: "gemini"` and `GOOGLE_API_KEY` set.
