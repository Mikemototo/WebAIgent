#!/usr/bin/env bash
set -euo pipefail

GATEWAY_URL=${GATEWAY_URL:-http://localhost:8787}
CHAT_URL=${CHAT_URL:-http://localhost:3001}
TENANT_ID=${TENANT_ID:-TENANT_123}

echo "[smoke] Checking gateway health at $GATEWAY_URL/health"
gateway_payload=$(curl -fsS "$GATEWAY_URL/health")
echo "$gateway_payload" | jq -e '.ok == true' > /dev/null
echo "[smoke] Gateway OK"

echo "[smoke] Checking chat health at $CHAT_URL/health"
chat_payload=$(curl -fsS "$CHAT_URL/health")
echo "$chat_payload" | jq -e '.ok == true' > /dev/null
echo "[smoke] Chat OK"

echo "[smoke] Exercising gateway chat endpoint"
chat_response=$(curl -fsS \
  -H 'Content-Type: application/json' \
  -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"question":"What is Knowledge Bot?","top_k":1}' \
  "$GATEWAY_URL/chat")
answer=$(echo "$chat_response" | jq -r '.answer')

if [[ -z "$answer" ]]; then
  echo "[smoke] Empty answer from chat" >&2
  exit 1
fi

if echo "$answer" | grep -qi "couldn’t find"; then
  echo "[smoke] Retrieval fallback detected; seed demo data before running smoke" >&2
  exit 1
fi

echo "[smoke] Gateway chat responded: $answer"

echo "[smoke] Completed"
