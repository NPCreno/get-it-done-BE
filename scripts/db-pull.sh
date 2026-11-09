#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f scripts/.env.dump ]; then set -a; . scripts/.env.dump; set +a; fi
: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL (env or scripts/.env.dump)}"

LABEL="${1:-neon}"
PG_IMAGE="${PG_IMAGE:-postgres:17}"
mkdir -p db_dumps
OUT="db_dumps/${LABEL}_$(date +%Y-%m-%d_%H%M).dump"
TMP="$OUT.tmp"
trap 'rm -f "$TMP"' EXIT

# pg_dump only reads from the source; it never writes to it.
docker run --rm -e SRC="$SOURCE_DATABASE_URL" "$PG_IMAGE" \
  sh -c 'pg_dump -Fc --no-owner --no-acl "$SRC"' > "$TMP"
mv "$TMP" "$OUT"
echo "Saved $OUT. Restore it with: scripts/db-restore.sh $OUT"
