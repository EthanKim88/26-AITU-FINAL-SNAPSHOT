#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:10000}"

for f in samples/scada/*.json; do
  echo "\n=== $(basename "$f") ==="
  curl -sS -X POST "$BASE_URL/api/import" \
    -H 'Content-Type: application/json' \
    --data-binary "@$f"
  echo

done

echo "\n=== SCADA SUMMARY ==="
if command -v jq >/dev/null 2>&1; then
  curl -sS "$BASE_URL/api/scada/summary" \
    | jq '{deviceCount:.stats.deviceCount, protocolCounts:.stats.protocolCounts, registerCount:.stats.registerCount, nonZeroCount:.stats.nonZeroCount}'
else
  curl -sS "$BASE_URL/api/scada/summary"
fi
