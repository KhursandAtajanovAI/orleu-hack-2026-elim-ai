#!/usr/bin/env python3
"""Честное сравнение моделей на ОДНОЙ и той же тестовой выборке (настоящие фото, без синтетики).

Каждая модель (ONNX) прогоняется тем же кодом, что и в ИИ-сервисе (app.detector), её классы
переводятся в наши 13 классов (COCO — через app.coco_map, дообученная — напрямую), и считается:
  * mAP50 по 13 классам (all-point AP, IoU ≥ 0.5) и AP50 по каждому классу;
  * «правильный контейнер» — для фото с одним предметом: совпал ли контейнер у самой
    уверенной рамки (критерий ТЗ 6.4 ≥ 75%);
  * скорость, мс на фото (CPU).

  python training/eval_compare.py --data data/merged --split test \
      --model base=models/base.onnx:coco --model finetuned=models/model.onnx:native --out report.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.analyze import map_class  # noqa: E402
from app.detector import Detector  # noqa: E402

RULES = json.loads((ROOT.parent / "contracts" / "waste-rules.json").read_text(encoding="utf-8"))
CLASSES = [c["ai_class"] for c in sorted(RULES["classes"], key=lambda c: c["id"])]
BIN = {c["ai_class"]: c["bin"] for c in RULES["classes"]}


def iou(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    x1 = np.maximum(a[0], b[:, 0]); y1 = np.maximum(a[1], b[:, 1])
    x2 = np.minimum(a[2], b[:, 2]); y2 = np.minimum(a[3], b[:, 3])
    inter = (x2 - x1).clip(0) * (y2 - y1).clip(0)
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1]) - inter + 1e-9)


def ap50(dets: list[tuple[float, str, np.ndarray]], gts: dict[str, np.ndarray]) -> float | None:
    """dets: (score, image_id, box); gts: image_id -> N×4. All-point интерполяция (как в COCO/VOC)."""
    npos = sum(len(v) for v in gts.values())
    if npos == 0:
        return None
    used = {k: np.zeros(len(v), bool) for k, v in gts.items()}
    tp = []
    for score, img, box in sorted(dets, key=lambda d: -d[0]):
        g = gts.get(img)
        if g is None or not len(g):
            tp.append(0); continue
        ov = iou(box, g)
        j = int(ov.argmax())
        if ov[j] >= 0.5 and not used[img][j]:
            used[img][j] = True; tp.append(1)
        else:
            tp.append(0)
    if not tp:
        return 0.0
    tp_c = np.cumsum(tp); fp_c = np.cumsum(1 - np.array(tp))
    rec = tp_c / npos; prec = tp_c / np.maximum(tp_c + fp_c, 1e-9)
    mrec = np.concatenate([[0], rec, [1]]); mpre = np.concatenate([[1], prec, [0]])
    mpre = np.flip(np.maximum.accumulate(np.flip(mpre)))
    i = np.where(mrec[1:] != mrec[:-1])[0]
    return float(np.sum((mrec[i + 1] - mrec[i]) * mpre[i + 1]))


def load_split(data: Path, split: str):
    items = []
    for img in sorted((data / "images" / split).glob("*")):
        if img.stem.startswith("synth_") or "_aug-" in img.stem:
            continue
        lbl = data / "labels" / split / f"{img.stem}.txt"
        if not lbl.exists():
            continue
        w, h = Image.open(img).size
        boxes = defaultdict(list)
        for row in lbl.read_text().split("\n"):
            p = row.split()
            if len(p) == 5:
                c, cx, cy, bw, bh = int(p[0]), *map(float, p[1:])
                boxes[CLASSES[c]].append([(cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h])
        items.append((img, {k: np.array(v) for k, v in boxes.items()}))
    return items


def evaluate(name: str, path: str, cmap: str, items, item_conf: float) -> dict:
    det = Detector(path)
    known = set(CLASSES)
    per_cls: dict[str, list] = defaultdict(list)
    gts: dict[str, dict[str, np.ndarray]] = defaultdict(dict)
    single_ok = single_n = 0
    t_total = 0.0
    for img_path, g in items:
        iid = img_path.stem
        for c, arr in g.items():
            gts[c][iid] = arr
        img = Image.open(img_path).convert("RGB")
        t = time.perf_counter()
        ds = det.detect(img, conf=0.001, iou=0.6, max_det=300)
        t_total += time.perf_counter() - t
        mapped = [(map_class(d.name, cmap, known), d) for d in ds]
        mapped = [(c, d) for c, d in mapped if c]
        for c, d in mapped:
            per_cls[c].append((d.confidence, iid, np.array(d.box)))
        n_gt = sum(len(v) for v in g.values())
        if n_gt == 1:
            single_n += 1
            gt_cls = next(iter(g))
            top = next(((c, d) for c, d in mapped if d.confidence >= item_conf), None)
            single_ok += bool(top and BIN[top[0]] == BIN[gt_cls])
    aps = {c: ap50(per_cls.get(c, []), gts[c]) for c in CLASSES if gts.get(c)}
    valid = [v for v in aps.values() if v is not None]
    return {
        "model": name, "version": det.version, "class_map": cmap,
        "mAP50": round(float(np.mean(valid)), 4) if valid else None,
        "AP50_per_class": {k: round(v, 4) for k, v in aps.items() if v is not None},
        "right_bin_single_item": round(single_ok / single_n, 4) if single_n else None,
        "single_item_photos": single_n,
        "ms_per_image": round(1000 * t_total / max(1, len(items)), 1),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=Path("data/merged"))
    ap.add_argument("--split", default="test")
    ap.add_argument("--model", action="append", required=True, help="имя=путь.onnx:coco|native")
    ap.add_argument("--item-conf", type=float, default=0.25)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    items = load_split(a.data, a.split)
    gt_count = defaultdict(int)
    for _, g in items:
        for c, arr in g.items():
            gt_count[c] += len(arr)
    results = []
    for spec in a.model:
        name, rest = spec.split("=", 1)
        path, cmap = rest.rsplit(":", 1)
        r = evaluate(name, path, cmap, items, a.item_conf)
        results.append(r)
        print(json.dumps(r, ensure_ascii=False, indent=2))
    report = {"split": a.split, "images": len(items), "gt_boxes_per_class": dict(gt_count), "results": results}
    if a.out:
        a.out.write_text(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
