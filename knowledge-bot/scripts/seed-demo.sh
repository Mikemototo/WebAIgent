#!/usr/bin/env bash
set -euo pipefail

TENANT_ID=${TENANT_ID:-TENANT_DEMO}
COLLECTION="docs_${TENANT_ID}"
QDRANT_URL=${QDRANT_URL:-http://localhost:6333}
OLLAMA_URL=${OLLAMA_BASE_URL:-http://localhost:11435}
DEMO_TITLE=${DEMO_TITLE:-"Knowledge Bot Overview"}
DEMO_URL=${DEMO_URL:-"https://example.org/docs/knowledge-bot"}
DEMO_TEXT=${DEMO_TEXT:-"Knowledge Bot is a local-first retrieval augmented generation stack that helps teams surface answers from their internal knowledge base. It runs on Qdrant, Ollama, and exposes a widget for instant answers."}

echo "[seed] Generating embedding via Ollama at $OLLAMA_URL"
embedding_json=$(curl -fsS "$OLLAMA_URL/api/embeddings" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"${EMBED_MODEL:-nomic-embed-text}\",\"prompt\":\"$DEMO_TEXT\"}")

vector=$(echo "$embedding_json" | jq '.embedding')
dimension=$(echo "$vector" | jq 'length')

if [[ "$dimension" -eq 0 ]]; then
  echo "[seed] Failed to produce embedding vector" >&2
  exit 1
fi

echo "[seed] Ensuring Qdrant collection $COLLECTION (dim=$dimension)"
if ! curl -fsS "$QDRANT_URL/collections/$COLLECTION" > /dev/null 2>&1; then
  curl -fsS -X PUT "$QDRANT_URL/collections/$COLLECTION" \
    -H "Content-Type: application/json" \
    -d "{\"vectors\":{\"size\":$dimension,\"distance\":\"Cosine\"}}" > /dev/null
fi

POINT_ID=${POINT_ID:-10001}
echo "[seed] Upserting demo point $POINT_ID"
curl -fsS -X PUT "$QDRANT_URL/collections/$COLLECTION/points?wait=true" \
  -H "Content-Type: application/json" \
  -d "{
    \"points\": [
      {
        \"id\": $POINT_ID,
        \"vector\": $vector,
        \"payload\": {
          \"title\": \"$DEMO_TITLE\",
          \"url\": \"$DEMO_URL\",
          \"text\": \"$DEMO_TEXT\"
        }
      }
    ]
  }" > /dev/null

echo "[seed] Demo knowledge seeded for tenant $TENANT_ID"
