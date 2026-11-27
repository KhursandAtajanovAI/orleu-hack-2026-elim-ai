#!/usr/bin/env python3
"""Сборщик открытых датасетов отходов (парсер фото для обучения, MVP).

Скачивает то, что лежит в открытом доступе, в формате, который понимает prepare.py:
  taco      — TACO (CC BY 4.0): разметка с GitHub, фото по ссылкам Flickr из annotations.json.
              --taco-unofficial добавляет ~3700 фото из annotations_unofficial.json.
  trashnet  — TrashNet (MIT): 2527 фото, 6 классов (Hugging Face, запасная ссылка — GitHub).

Ошибки отдельных фото не останавливают сбор: в конце печатается отчёт, сколько скачано.
  python training/collect.py --out data/raw --taco --trashnet --workers 32
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

TACO_ANN = "https://raw.githubusercontent.com/pedropro/TACO/master/data/{name}"
TRASHNET_URLS = [
    "https://huggingface.co/datasets/garythung/trashnet/resolve/main/dataset-resized.zip",
    "https://github.com/garythung/trashnet/raw/master/data/dataset-resized.zip",
]
UA = {"User-Agent": "kaida-dataset-collector/1.0"}


def fetch(url: str, dst: Path, timeout: int = 60) -> bool:
    if dst.exists() and dst.stat().st_size > 0:
        return True
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        if not data:
            return False
        tmp = dst.with_suffix(dst.suffix + ".part")
        tmp.write_bytes(data)
        tmp.rename(dst)
        return True
    except Exception as e:  # noqa: BLE001 — сеть ненадёжна, считаем и идём дальше
        print(f"  ✗ {url}: {e}", file=sys.stderr)
        return False


def collect_taco(out: Path, workers: int, unofficial: bool, limit: int | None) -> dict:
    root = out / "TACO" / "data"
    files = ["annotations.json"] + (["annotations_unofficial.json"] if unofficial else [])
    report = {}
    merged = None
    for name in files:
        ann = root / name
        if not fetch(TACO_ANN.format(name=name), ann):
            report[name] = "нет разметки"
            continue
        coco = json.loads(ann.read_text(encoding="utf-8"))
        imgs = coco["images"][:limit] if limit else coco["images"]
        jobs = [(i.get("flickr_url") or i.get("flickr_640_url"), root / i["file_name"]) for i in imgs]
        jobs = [(u, p) for u, p in jobs if u]
        with ThreadPoolExecutor(workers) as ex:
            ok = sum(ex.map(lambda j: fetch(*j), jobs))
        report[name] = {"images": len(jobs), "downloaded": ok}
        if merged is None:
            merged = coco
        else:  # объединяем в один COCO-файл: id фото и разметки сдвигаем
            off_img = max(i["id"] for i in merged["images"]) + 1
            off_ann = max(a["id"] for a in merged["annotations"]) + 1
            merged["images"] += [{**i, "id": i["id"] + off_img} for i in coco["images"]]
            merged["annotations"] += [{**a, "id": a["id"] + off_ann, "image_id": a["image_id"] + off_img}
                                      for a in coco["annotations"]]
    if merged is not None and unofficial:
        (root / "annotations_merged.json").write_text(json.dumps(merged))
    return report


def collect_trashnet(out: Path) -> dict:
    z = out / "trashnet.zip"
    for url in TRASHNET_URLS:
        if fetch(url, z, timeout=300) and zipfile.is_zipfile(z):
            with zipfile.ZipFile(z) as f:
                f.extractall(out / "trashnet")
            root = next((p.parent for p in (out / "trashnet").rglob("cardboard") if p.is_dir()), None)
            n = sum(1 for _ in root.rglob("*.jpg")) if root else 0
            return {"url": url, "root": str(root), "images": n}
        z.unlink(missing_ok=True)
    return {"error": "TrashNet недоступен ни по одной ссылке"}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path("data/raw"))
    ap.add_argument("--taco", action="store_true")
    ap.add_argument("--taco-unofficial", action="store_true")
    ap.add_argument("--trashnet", action="store_true")
    ap.add_argument("--workers", type=int, default=32)
    ap.add_argument("--limit", type=int, help="не больше N фото из каждого файла разметки (для проверки)")
    a = ap.parse_args()
    report = {}
    if a.taco or a.taco_unofficial:
        report["taco"] = collect_taco(a.out, a.workers, a.taco_unofficial, a.limit)
    if a.trashnet:
        report["trashnet"] = collect_trashnet(a.out)
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "collect_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
