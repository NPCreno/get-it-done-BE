#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p db_dumps
OUT="db_dumps/local_$(date +%Y-%m-%d_%H%M).dump"
TMP="$OUT.tmp"
trap 'rm -f "$TMP"' EXIT

docker compose -f docker-compose.dev.yml up -d --wait postgres
docker compose -f docker-compose.dev.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TMP"
mv "$TMP" "$OUT"
echo "Saved $OUT"
