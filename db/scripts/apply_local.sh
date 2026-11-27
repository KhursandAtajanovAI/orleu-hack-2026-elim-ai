#!/usr/bin/env bash
# Применить шим Supabase + все миграции к «голому» PostgreSQL/PostGIS (CI и локально).
# Использование: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres db/scripts/apply_local.sh [--tests]
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL не задан}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f tests/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do
  echo "→ $f"
  "${PSQL[@]}" -1 -f "$f"
done
if [[ "${1:-}" == "--tests" ]]; then
  for f in tests/[1-9]*.sql; do
    echo "🧪 $f"
    "${PSQL[@]}" -o /dev/null -f "$f"
  done
  echo "✅ все SQL-тесты пройдены"
fi
