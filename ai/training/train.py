#!/usr/bin/env python3
"""Дообучение YOLO (Ultralytics, версия n/s, веса COCO) на объединённом датасете (ТЗ 6.2).

GPU — Colab/Kaggle (см. notebooks/train_kaggle.ipynb), CPU — только для проверки.
  python training/train.py --data data/merged/data.yaml --model yolo11n.pt --epochs 80
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/merged/data.yaml")
    ap.add_argument("--model", default="yolo11n.pt", help="yolo11n.pt / yolo11s.pt / yolov8n.pt (веса COCO)")
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=-1, help="-1 — автоподбор под память GPU")
    ap.add_argument("--device", default=None, help="0 — GPU, cpu — процессор")
    ap.add_argument("--name", default="waste-yolo")
    ap.add_argument("--project", default="runs")
    ap.add_argument("--patience", type=int, default=20)
    ap.add_argument("--fraction", type=float, default=1.0, help="доля датасета (для быстрой проверки)")
    ap.add_argument("--time", type=float, default=None, help="лимит обучения в часах (важнее epochs; для CPU в CI)")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--cache", default="false", help="ram / disk / false — кэш уменьшенных фото")
    a = ap.parse_args()

    from ultralytics import YOLO

    model = YOLO(a.model)
    model.train(
        data=a.data, epochs=a.epochs, imgsz=a.imgsz, batch=a.batch, device=a.device,
        project=a.project, name=a.name, patience=a.patience, fraction=a.fraction, workers=a.workers,
        cache={"ram": "ram", "disk": "disk"}.get(a.cache, False),
        **({"time": a.time} if a.time else {}),
        # аугментации: освещение (HSV), масштаб/поворот, мозаика, mixup; снег/ночь — augment_weather.py
        hsv_h=0.015, hsv_s=0.6, hsv_v=0.5, degrees=10, translate=0.1, scale=0.5, fliplr=0.5,
        mosaic=1.0, mixup=0.1, close_mosaic=10, cos_lr=True, plots=True,
    )
    best = YOLO(str(model.trainer.best))
    summary = {"weights": str(Path(model.trainer.best))}
    for split in ("val", "test"):
        m = best.val(data=a.data, split=split, imgsz=a.imgsz, plots=split == "test")
        # ap50 — только по классам, которые есть в выборке (ap_class_index), без подстановки среднего
        summary[split] = {"mAP50": round(float(m.box.map50), 4), "mAP50_95": round(float(m.box.map), 4),
                          "precision": round(float(m.box.mp), 4), "recall": round(float(m.box.mr), 4),
                          "AP50_per_class": {best.names[int(c)]: round(float(v), 4)
                                             for c, v in zip(m.box.ap_class_index, m.box.ap50)}}
    summary["mAP50"] = summary["test"]["mAP50"]
    out = Path(model.trainer.save_dir) / "summary.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print("критерий 6.4 mAP50 ≥ 0.4:", "✅" if summary["mAP50"] >= 0.4 else "❌")


if __name__ == "__main__":
    main()
