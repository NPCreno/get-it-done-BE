#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

DUMP_FILE="${1:-$(ls -t db_dumps/*.dump 2>/dev/null | head -1 || true)}"
if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "No dump file found. Usage: $0 [path/to/file.dump]" >&2
  exit 1
fi

echo "Restoring $DUMP_FILE into the local docker database (local data will be replaced)"
docker compose -f docker-compose.dev.yml up -d --wait postgres

docker compose -f docker-compose.dev.yml exec -T postgres sh -c \
  'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'

docker compose -f docker-compose.dev.yml exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --no-comments' < "$DUMP_FILE"

echo "Done. Run your migrations next if the code is newer than the dump."
