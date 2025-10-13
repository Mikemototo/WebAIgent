#!/usr/bin/env bash
set -euo pipefail
OLLAMA="${OLLAMA_BASE_URL:-http://localhost:11435}"
pull() { curl -s "$OLLAMA/api/pull" -d "{\"name\": \"$1\"}"; echo; }

CHAT_MODEL="${CHAT_MODEL:-llama3.1:8b}"
EMBED_MODEL="${EMBED_MODEL:-nomic-embed-text}"
EMBED_PROVIDER="${EMBED_PROVIDER:-local}"

echo "Pulling chat model: $CHAT_MODEL"
pull "$CHAT_MODEL"

if [ "$EMBED_PROVIDER" = "cloud" ]; then
  echo "Skipping local embedding pull (EMBED_PROVIDER=cloud)"
else
  echo "Pulling embedding model: $EMBED_MODEL"
  pull "$EMBED_MODEL"
fi
