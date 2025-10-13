#!/usr/bin/env bash
set -e
echo "Checking services..."
curl -fsSL http://localhost:6333/ | head -n1 && echo "Qdrant ok"
curl -fsSL http://localhost:11435/api/tags | jq '.models | length' && echo "Ollama ok"
curl -fsSL http://localhost:8787/health | jq .
