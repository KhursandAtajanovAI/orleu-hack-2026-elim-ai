#!/usr/bin/env python3
"""Проверка качества на своих фото Астаны (критерий 6.4: правильный контейнер ≥ 75%).

Вход — папка с фото и labels.csv: file,expected (expected — класс ИИ или тип контейнера).
Фото снимает команда (30–50 шт., без людей и номеров в кадре).
  python training/eval_astana.py --model models/model.onnx --dir data/astana_items
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.analyze import analyze  # noqa: E402
from app.detector import Detector  # noqa: E402
from app.errors import AiError  # noqa: E402
from app.rules import WASTE_TYPES, load_rules  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ROOT / "models" / "model.onnx"))
    ap.add_argument("--dir", type=Path, required=True)
    ap.add_argument("--csv", type=Path)
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    rules = load_rules(str(ROOT.parent / "contracts" / "waste-rules.json"))
    det = Detector(a.model)
    rows = list(csv.DictReader(open(a.csv or a.dir / "labels.csv", encoding="utf-8")))
    ok = 0
    details = []
    for r in rows:
        exp = r["expected"].strip()
        exp_bin = exp if exp in WASTE_TYPES else rules.get(exp).bin
        try:
            res = analyze((a.dir / r["file"]).read_bytes(), detector=det, rules=rules, mode="item", conf=a.conf)
            got = res["primary"]["bin"] if res["primary"] else None
            cls = res["primary"]["class"] if res["primary"] else None
        except AiError as e:
            got, cls = None, e.code
        hit = got == exp_bin
        ok += hit
        details.append({"file": r["file"], "expected_bin": exp_bin, "got_bin": got, "got_class": cls, "ok": hit})
    acc = ok / max(1, len(rows))
    report = {"model": det.version, "photos": len(rows), "correct_bin": ok, "accuracy": round(acc, 3),
              "meets_75pct": acc >= 0.75, "details": details}
    print(json.dumps({k: v for k, v in report.items() if k != "details"}, ensure_ascii=False, indent=2))
    if a.out:
        a.out.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(0 if acc >= 0.75 else 1)


if __name__ == "__main__":
    main()
