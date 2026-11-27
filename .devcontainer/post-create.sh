#!/usr/bin/env bash
# Codespaces: ставит зависимости всех частей. Дальше — см. README «Как запустить».
set -e
npm ci
python -m pip install -r ai/requirements-dev.txt
[ -f .env ] || cp .env.example .env
echo "Готово. Supabase: cd db && supabase start · ИИ: cd ai && uvicorn app.main:app --port 8000 · Моки: npm run contracts:mock"
