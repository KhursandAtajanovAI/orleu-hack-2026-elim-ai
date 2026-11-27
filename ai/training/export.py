#!/usr/bin/env python3
"""Экспорт весов в ONNX + версия модели в метаданных + проверка скорости на CPU (ТЗ 6.2).

  python training/export.py --weights runs/waste-yolo/weights/best.pt --version waste-yolo-0.1
  python training/export.py --weights yolo11n.pt --version waste-yolo-0.0-coco   # стартовая COCO-модель
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--version", required=True, help="имя версии, попадает в каждый ответ и в scans/pickups")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--out", default="models/model.onnx")
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument("--bench", action="store_true", help="сразу замерить скорость на CPU")
    a = ap.parse_args()

    import onnx
    from ultralytics import YOLO

    model = YOLO(a.weights)
    path = Path(model.export(format="onnx", imgsz=a.imgsz, opset=a.opset, simplify=True, dynamic=False))
    m = onnx.load(str(path))
    meta = {p.key: p.value for p in m.metadata_props}
    meta["model_version"] = a.version
    meta["source_weights"] = Path(a.weights).name
    del m.metadata_props[:]
    for k, v in meta.items():
        e = m.metadata_props.add()
        e.key, e.value = k, str(v)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(m, str(out))
    if path.resolve() != out.resolve():
        path.unlink(missing_ok=True)
    card = {"model_version": a.version, "imgsz": a.imgsz, "names": meta.get("names"), "bytes": out.stat().st_size}
    out.with_suffix(".json").write_text(json.dumps(card, ensure_ascii=False, indent=2))
    print(json.dumps(card, ensure_ascii=False, indent=2))
    if a.bench:
        from bench import bench  # type: ignore
        bench(str(out))
    shutil.rmtree("runs/detect/predict", ignore_errors=True)


if __name__ == "__main__":
    main()
