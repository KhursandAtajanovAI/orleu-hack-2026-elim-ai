#!/usr/bin/env bash
# Снимает ответы API с настоящей базы (сценарий db/tests/10_*) в contracts/mocks/*.json.
#   DATABASE_URL=postgres://... db/scripts/export_mocks.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?DATABASE_URL не задан}"
mkdir -p contracts/mocks
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X -o /dev/null -v mocks_dir="$PWD/contracts/mocks" -f db/tests/10_waste_path_scenario.sql 2>/dev/null
echo "моки обновлены: $(ls contracts/mocks | wc -l) файлов"
