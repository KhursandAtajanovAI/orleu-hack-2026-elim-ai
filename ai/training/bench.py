#!/usr/bin/env python3
"""Скорость инференса на CPU (критерий 6.4: ответ ≤ 3 с для изображения 1280 px).

Меряет весь путь сервиса: декодирование JPEG 1280 px → проверка качества →
letterbox → ONNX Runtime → NMS → правила. Пишет отчёт в JSON.
  python training/bench.py models/model.onnx --runs 20
"""
from __future__ import annotations

import argparse
import io
import json
import statistics
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def bench(model: str, runs: int = 20, out: str | None = None) -> dict:
    from app.analyze import analyze
    from app.detector import Detector
    from app.rules import load_rules

    rules = load_rules(str(ROOT.parent / "contracts" / "waste-rules.json"))
    det = Detector(model)
    rng = np.random.default_rng(0)
    buf = io.BytesIO()
    Image.fromarray(rng.integers(0, 255, (960, 1280, 3), dtype=np.uint8)).save(buf, format="JPEG", quality=85)
    data = buf.getvalue()
    times = []
    for _ in range(runs):
        t = time.perf_counter()
        try:
            analyze(data, detector=det, rules=rules, mode="container", container_type="plastic")
        except Exception:
            pass
        times.append((time.perf_counter() - t) * 1000)
    res = {"model": det.version, "providers": det.providers, "runs": runs, "imgsz": det.imgsz,
           "p50_ms": round(statistics.median(times), 1), "p95_ms": round(sorted(times)[int(0.95 * (runs - 1))], 1),
           "max_ms": round(max(times), 1), "warmup_ms": det.warmup_ms}
    res["meets_3s"] = res["p95_ms"] <= 3000
    print(json.dumps(res, ensure_ascii=False, indent=2))
    if out:
        Path(out).write_text(json.dumps(res, ensure_ascii=False, indent=2))
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("--runs", type=int, default=20)
    ap.add_argument("--out")
    a = ap.parse_args()
    r = bench(a.model, a.runs, a.out)
    sys.exit(0 if r["meets_3s"] else 1)
