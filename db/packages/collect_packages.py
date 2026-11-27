#!/usr/bin/env python3
"""Парсер базы упаковок по штрихкоду (MVP): открытые источники + синтетика → packages.

Источники:
  off        — Open Food Facts (ODbL): товары, продающиеся в Казахстане и соседних странах,
               поле packagings (материал, форма, «перерабатывается»).
  opf        — Open Products Facts (ODbL): непищевые товары (бытовая химия, батарейки…).
  synthetic  — синтетические упаковки с префиксом GS1 Казахстана 487 и верной контрольной
               цифрой EAN-13: типичные товары магазинов Астаны по всем 13 классам ИИ.
               Нужны, пока в открытых базах мало казахстанских товаров. Бренды выдуманные.

Материал упаковки переводится в один из 13 классов ИИ (contracts/waste-rules.json) —
тот же класс, что выдаёт модель по фото, поэтому контейнер и баллы считаются одинаково.

Выход: packages.jsonl (все записи) и seed_packages.sql (upsert в public.packages).
  python db/packages/collect_packages.py --sources off,opf,synthetic --out db/packages/out
  python db/packages/collect_packages.py --sources synthetic --synthetic 500 --out db/packages/out
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLASSES = [c["ai_class"] for c in json.loads((ROOT / "contracts" / "waste-rules.json").read_text(encoding="utf-8"))["classes"]]
UA = {"User-Agent": "kaida-packages-parser/1.0 (hackathon MVP)"}
FIELDS = "code,product_name,product_name_ru,product_name_kk,brands,quantity,packagings,packaging_tags,packaging_materials_tags,countries_tags"
HOSTS = {"off": "https://world.openfoodfacts.org", "opf": "https://world.openproductsfacts.org"}
COUNTRIES = ["en:kazakhstan", "en:russia", "en:kyrgyzstan", "en:uzbekistan", "en:belarus"]

# --------------------------------------------------------------- материал → класс ИИ
# Правила проверяются сверху вниз по тегу материала/формы (подстрока). Порядок важен:
# «pet» раньше «plastic», «aluminium» раньше «metal», «carton/tetra» раньше «paper».
MATERIAL_RULES: list[tuple[str, str]] = [
    ("metallised", "other"), ("metallized", "other"), ("multilayer-sachet", "other"),
    ("battery", "hazardous"), ("batter", "hazardous"), ("lamp", "hazardous"), ("bulb", "hazardous"),
    ("tetra", "tetra_pak"), ("beverage-carton", "tetra_pak"), ("drink-carton", "tetra_pak"),
    ("multilayer-composite", "tetra_pak"), ("composite", "tetra_pak"), ("84-c-pap", "tetra_pak"),
    ("pet-polyethylene-terephthalate", "pet_bottle"), ("1-pet", "pet_bottle"), ("en:pet", "pet_bottle"),
    ("plastic-film", "film"), ("film", "film"), ("bag", "film"), ("wrap", "film"), ("sachet", "film"),
    ("ldpe", "film"), ("4-ldpe", "film"), ("flow-pack", "film"),
    ("hdpe", "hard_plastic"), ("2-hdpe", "hard_plastic"), ("pp-polypropylene", "hard_plastic"), ("5-pp", "hard_plastic"),
    ("ps-polystyrene", "other"), ("6-ps", "other"), ("polystyrene", "other"),
    ("plastic", "hard_plastic"),
    ("aluminium", "aluminum_can"), ("aluminum", "aluminum_can"), ("41-alu", "aluminum_can"),
    ("steel", "tin_can"), ("tin", "tin_can"), ("40-fe", "tin_can"), ("metal", "tin_can"),
    ("glass", "glass"),
    ("corrugated", "cardboard"), ("cardboard", "cardboard"), ("20-pap", "cardboard"), ("carton", "cardboard"),
    ("paper", "paper"), ("21-pap", "paper"), ("22-pap", "paper"),
    ("textile", "textile"), ("cotton", "textile"), ("wood", "other"),
]
SHAPE_HINTS = {"can": {"aluminum_can", "tin_can"}, "bottle": {"pet_bottle", "glass", "hard_plastic"}}


def classify(material: str | None, shape: str | None) -> str | None:
    m = (material or "").lower()
    for kw, cls in MATERIAL_RULES:
        if kw in m:
            if cls == "hard_plastic" and shape and "bottle" in shape.lower() and "pet" in m:
                return "pet_bottle"
            if cls == "tin_can" and shape and "can" in shape.lower() and "drink" in (shape or ""):
                return "aluminum_can"
            return cls
    return None


def main_component(p: dict) -> tuple[str | None, str | None, str | None]:
    """Самый «тяжёлый» компонент упаковки (бутылка важнее крышки) → (material, shape, ai_class)."""
    comps = p.get("packagings") or []
    order = ["bottle", "can", "jar", "box", "brick", "tray", "pot", "bag", "film", "wrapper", "pouch", "sachet"]

    def rank(c: dict) -> int:
        s = str(c.get("shape") or "")
        return next((i for i, k in enumerate(order) if k in s), len(order))

    for c in sorted(comps, key=rank):
        cls = classify(c.get("material"), c.get("shape"))
        if cls:
            return c.get("material"), c.get("shape"), cls
    for tag in (p.get("packaging_materials_tags") or []) + (p.get("packaging_tags") or []):
        cls = classify(tag, None)
        if cls:
            return tag, None, cls
    return None, None, None


def get_json(url: str, retries: int = 3) -> dict | None:
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {url} ({e}), повтор {i + 1}/{retries}", file=sys.stderr)
            time.sleep(10 * (i + 1))
    return None


def parse_open_facts(source: str, max_pages: int, page_size: int, delay: float) -> list[dict]:
    """Поиск по странам продажи. Лимит API поиска ~10 запросов в минуту — пауза delay секунд."""
    out: list[dict] = []
    seen: set[str] = set()
    for country in COUNTRIES:
        for page in range(1, max_pages + 1):
            q = urllib.parse.urlencode({"countries_tags": country, "fields": FIELDS, "page": page,
                                        "page_size": page_size, "sort_by": "unique_scans_n"})
            data = get_json(f"{HOSTS[source]}/api/v2/search?{q}")
            time.sleep(delay)
            prods = (data or {}).get("products") or []
            if not prods:
                break
            for p in prods:
                code = str(p.get("code") or "").strip()
                if not code.isdigit() or not 8 <= len(code) <= 14 or code in seen:
                    continue
                material, shape, cls = main_component(p)
                if not cls:
                    continue  # без данных об упаковке пользы для сортировки нет
                seen.add(code)
                out.append({
                    "gtin": code,
                    "name": p.get("product_name_ru") or p.get("product_name") or p.get("product_name_kk"),
                    "brand": (p.get("brands") or "").split(",")[0].strip() or None,
                    "quantity": p.get("quantity"), "material": material, "shape": shape, "ai_class": cls,
                    "countries": [c.split(":")[-1] for c in p.get("countries_tags") or []][:10],
                    "source": source, "verified": False,
                    "raw": {"packagings": p.get("packagings") or [], "packaging_tags": p.get("packaging_tags") or []},
                })
            print(f"{source} {country} стр. {page}: всего {len(out)}")
            if len(prods) < page_size:
                break
    return out


# --------------------------------------------------------------- синтетика
def ean13(body12: str) -> str:
    s = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(body12))
    return body12 + str((10 - s % 10) % 10)


SYNTH: dict[str, list[tuple[str, list[str], str, str, tuple[float, float]]]] = {
    # класс: [(название, объёмы, материал, форма, (вес упаковки г от–до))]
    "pet_bottle": [("Вода питьевая негазированная", ["0,5 л", "1 л", "1,5 л", "5 л"], "en:pet-polyethylene-terephthalate", "en:bottle", (12, 80)),
                   ("Газированный напиток", ["0,5 л", "1 л", "2 л"], "en:pet-polyethylene-terephthalate", "en:bottle", (15, 45)),
                   ("Айран", ["0,5 л", "1 л"], "en:pet-polyethylene-terephthalate", "en:bottle", (18, 30)),
                   ("Масло подсолнечное", ["1 л", "3 л"], "en:pet-polyethylene-terephthalate", "en:bottle", (25, 70))],
    "hard_plastic": [("Йогурт питьевой", ["270 г", "450 г"], "en:hdpe-high-density-polyethylene", "en:bottle", (10, 20)),
                     ("Сметана", ["200 г", "400 г"], "en:pp-polypropylene", "en:pot", (8, 15)),
                     ("Шампунь", ["250 мл", "400 мл"], "en:hdpe-high-density-polyethylene", "en:bottle", (25, 45)),
                     ("Средство для мытья посуды", ["500 мл", "1 л"], "en:hdpe-high-density-polyethylene", "en:bottle", (30, 50))],
    "film": [("Хлеб нарезной", ["400 г", "600 г"], "en:ldpe-low-density-polyethylene", "en:bag", (3, 6)),
             ("Молоко в пакете", ["900 мл", "1 л"], "en:ldpe-low-density-polyethylene", "en:bag", (4, 7)),
             ("Макароны", ["400 г", "900 г"], "en:pp-polypropylene-film", "en:film", (3, 6)),
             ("Сахар", ["1 кг"], "en:plastic-film", "en:bag", (4, 8))],
    "paper": [("Газета", ["1 шт."], "en:paper", "en:sheet", (60, 150)),
              ("Мука", ["1 кг", "2 кг"], "en:paper", "en:bag", (15, 25)),
              ("Салфетки бумажные", ["100 шт."], "en:paper", "en:wrapper", (5, 10))],
    "cardboard": [("Яйца куриные С1", ["10 шт.", "30 шт."], "en:cardboard", "en:tray", (30, 90)),
                  ("Чай чёрный", ["100 г", "250 г"], "en:cardboard", "en:box", (20, 40)),
                  ("Кукурузные хлопья", ["300 г", "500 г"], "en:cardboard", "en:box", (40, 70))],
    "tetra_pak": [("Молоко ультрапастеризованное", ["1 л"], "en:tetra-pak", "en:brick", (25, 30)),
                  ("Сок яблочный", ["0,2 л", "1 л"], "en:beverage-carton", "en:brick", (8, 30)),
                  ("Кефир", ["0,5 л", "1 л"], "en:tetra-pak", "en:brick", (15, 30))],
    "glass": [("Пиво светлое", ["0,5 л"], "en:glass", "en:bottle", (250, 350)),
              ("Соус томатный", ["300 г", "500 г"], "en:glass", "en:jar", (150, 250)),
              ("Минеральная вода", ["0,5 л", "1 л"], "en:glass", "en:bottle", (280, 450))],
    "aluminum_can": [("Энергетический напиток", ["0,25 л", "0,45 л"], "en:aluminium", "en:drink-can", (11, 16)),
                     ("Пиво в банке", ["0,45 л", "0,5 л"], "en:aluminium", "en:drink-can", (13, 17))],
    "tin_can": [("Говядина тушёная", ["325 г", "525 г"], "en:steel", "en:can", (45, 70)),
                ("Горошек зелёный", ["400 г"], "en:steel", "en:can", (40, 55)),
                ("Сгущённое молоко", ["380 г"], "en:steel", "en:can", (40, 50))],
    "organic": [("Бананы весовые", ["1 кг"], "en:none", "en:none", (1, 2))],
    "textile": [("Носки хлопковые", ["1 пара"], "en:cotton", "en:label", (1, 3))],
    "hazardous": [("Батарейки AA", ["2 шт.", "4 шт."], "en:battery", "en:blister", (10, 20)),
                  ("Лампа светодиодная", ["1 шт."], "en:lamp", "en:box", (30, 60))],
    "other": [("Чипсы картофельные", ["90 г", "150 г"], "en:metallised-plastic", "en:bag", (3, 6)),
              ("Кофе растворимый 3в1", ["10 шт."], "en:multilayer-sachet", "en:sachet", (2, 4))],
}
BRANDS = ["Дала Фуд", "Астана Сүт", "Таза Су", "Жайлау", "Есіл", "Алтын Дән", "Сарыарқа", "Қазына", "Ақ Бидай", "Нұр Сауда"]


def synthetic(n: int, seed: int) -> list[dict]:
    rnd = random.Random(seed)
    out, seen = [], set()
    classes = [c for c in SYNTH if c in CLASSES]
    while len(out) < n:
        cls = classes[len(out) % len(classes)] if len(out) < len(classes) * 3 else rnd.choice(classes)
        name, sizes, material, shape, (wmin, wmax) = rnd.choice(SYNTH[cls])
        code = ean13("487" + f"{rnd.randrange(10 ** 9):09d}")
        if code in seen:
            continue
        seen.add(code)
        out.append({"gtin": code, "name": name, "brand": rnd.choice(BRANDS), "quantity": rnd.choice(sizes),
                    "material": None if material == "en:none" else material,
                    "shape": None if shape == "en:none" else shape, "ai_class": cls,
                    "weight_g": round(rnd.uniform(wmin, wmax), 1), "countries": ["kazakhstan"],
                    "source": "synthetic", "verified": False, "raw": {"synthetic": True}})
    return out


# --------------------------------------------------------------- выход
def sql_str(v) -> str:
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def to_sql(rows: list[dict]) -> str:
    head = ("-- СГЕНЕРИРОВАНО db/packages/collect_packages.py — база упаковок по штрихкоду.\n"
            "insert into public.packages (gtin, name, brand, quantity, material, shape, ai_class, weight_g, countries, source, verified, raw) values\n")
    vals = []
    for r in rows:
        countries = "array[" + ",".join(sql_str(c) for c in r.get("countries") or []) + "]::text[]"
        vals.append("  (" + ", ".join([
            sql_str(r["gtin"]), sql_str((r.get("name") or "")[:300] or None), sql_str((r.get("brand") or "")[:120] or None),
            sql_str((r.get("quantity") or "")[:60] or None), sql_str(r.get("material")), sql_str(r.get("shape")),
            sql_str(r["ai_class"]), "null" if r.get("weight_g") is None else str(r["weight_g"]), countries,
            sql_str(r["source"]), "true" if r.get("verified") else "false",
            sql_str(json.dumps(r.get("raw") or {}, ensure_ascii=False)) + "::jsonb"]) + ")")
    tail = ("\non conflict (gtin) do update set name = coalesce(excluded.name, packages.name), brand = coalesce(excluded.brand, packages.brand),\n"
            "  quantity = coalesce(excluded.quantity, packages.quantity), material = excluded.material, shape = excluded.shape,\n"
            "  ai_class = excluded.ai_class, raw = excluded.raw\n  where not packages.verified;\n")
    return head + ",\n".join(vals) + tail


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources", default="off,opf,synthetic")
    ap.add_argument("--out", type=Path, default=Path("db/packages/out"))
    ap.add_argument("--max-pages", type=int, default=20, help="страниц по 100 товаров на страну")
    ap.add_argument("--page-size", type=int, default=100)
    ap.add_argument("--delay", type=float, default=6.5, help="пауза между запросами поиска, с")
    ap.add_argument("--synthetic", type=int, default=600)
    ap.add_argument("--seed", type=int, default=487)
    a = ap.parse_args()
    rows: dict[str, dict] = {}
    for src in [s.strip() for s in a.sources.split(",") if s.strip()]:
        got = synthetic(a.synthetic, a.seed) if src == "synthetic" else parse_open_facts(src, a.max_pages, a.page_size, a.delay)
        for r in got:
            rows.setdefault(r["gtin"], r)  # реальные источники идут первыми и не перетираются синтетикой
    data = list(rows.values())
    a.out.mkdir(parents=True, exist_ok=True)
    with open(a.out / "packages.jsonl", "w", encoding="utf-8") as f:
        for r in data:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (a.out / "seed_packages.sql").write_text(to_sql(data) if data else "-- пусто\n", encoding="utf-8")
    rep = {"total": len(data), "by_source": Counter(r["source"] for r in data),
           "by_class": Counter(r["ai_class"] for r in data)}
    (a.out / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2))
    print(json.dumps(rep, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
