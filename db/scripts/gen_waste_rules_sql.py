#!/usr/bin/env python3
"""Генерирует миграцию-сид справочника waste_rules и bonus_rules из contracts/waste-rules.json.

Запуск:  python db/scripts/gen_waste_rules_sql.py            # перезаписать миграцию
         python db/scripts/gen_waste_rules_sql.py --check    # CI: проверить, что миграция актуальна
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "contracts" / "waste-rules.json"
OUT = ROOT / "db" / "supabase" / "migrations" / "20261127000600_reference_data.sql"


def q(v: object) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def render() -> str:
    data = json.loads(SRC.read_text(encoding="utf-8"))
    bins = data["bins"]
    rows = []
    for c in data["classes"]:
        b = bins[c["bin"]]
        rows.append(
            "  ("
            + ", ".join(
                q(x)
                for x in [
                    c["ai_class"], c["label_ru"], c["label_kk"], c["bin"], c["is_recyclable"],
                    c["special_handling"], c["hint_ru"], c["hint_kk"], c["usage_ru"], c["usage_kk"],
                    b["icon"], b["color"], c["id"],
                ]
            )
            + ")"
        )
    return f"""-- =============================================================================
-- «Қайда?» · Миграция 6: справочники waste_rules и bonus_rules (ТЗ 3, 6.1, 12)
-- СГЕНЕРИРОВАНО из contracts/waste-rules.json скриптом db/scripts/gen_waste_rules_sql.py.
-- Не редактируйте руками — правьте JSON и перегенерируйте (CI проверяет).
-- Правила по умолчанию (city_id = null); город может переопределить свои.
-- =============================================================================
set search_path = public, extensions;

insert into public.waste_rules
  (ai_class, label_ru, label_kk, bin, is_recyclable, special_handling, hint_ru, hint_kk, usage_ru, usage_kk, icon, color, sort_order)
values
{(","+chr(10)).join(rows)}
on conflict (coalesce(city_id, '00000000-0000-0000-0000-000000000000'::uuid), ai_class) do update set
  label_ru = excluded.label_ru, label_kk = excluded.label_kk, bin = excluded.bin,
  is_recyclable = excluded.is_recyclable, special_handling = excluded.special_handling,
  hint_ru = excluded.hint_ru, hint_kk = excluded.hint_kk, usage_ru = excluded.usage_ru, usage_kk = excluded.usage_kk,
  icon = excluded.icon, color = excluded.color, sort_order = excluded.sort_order;

-- Ставки бонусов (ТЗ 12): все ставки и пороги — в справочнике, а не в коде.
insert into public.bonus_rules (code, waste_type, rate_per_kg, fixed_amount, params) values
  ('drop_off_rate', 'plastic', 15, null, '{{}}'),
  ('drop_off_rate', 'paper',    8, null, '{{}}'),
  ('drop_off_rate', 'glass',    5, null, '{{}}'),
  ('drop_off_rate', 'metal',   20, null, '{{}}'),
  ('drop_off_rate', 'organic',  2, null, '{{}}'),
  ('site_pool_rate', null,      3, null, '{{"cleanliness_coef": [{{"min": 80, "coef": 1.0}}, {{"min": 50, "coef": 0.5}}, {{"min": 0, "coef": 0}}], "period": "week"}}'),
  ('report_confirmed', null, null, 50, '{{}}'),
  ('drop_off_limits', null, null, null, '{{"daily_limit": 5, "alert_kg": 50}}')
on conflict do nothing;
"""


def main() -> int:
    sql = render()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != sql:
            print(f"{OUT.relative_to(ROOT)} устарел: запустите python db/scripts/gen_waste_rules_sql.py", file=sys.stderr)
            return 1
        print("waste_rules: миграция актуальна")
        return 0
    OUT.write_text(sql, encoding="utf-8")
    print(f"записано: {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
