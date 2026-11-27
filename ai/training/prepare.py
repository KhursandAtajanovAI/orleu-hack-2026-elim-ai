#!/usr/bin/env python3
"""Подготовка датасетов к обучению (ТЗ 6.2): привести разметку к нашим 13 классам,
объединить, разделить train/val/test 80/10/10.

Источники:
  taco      — COCO-разметка TACO (annotations.json + изображения)
  trashnet  — папки классов TrashNet (одна вещь на фото → рамка = кадр)
  yolo      — любой YOLO-датасет (Roboflow Universe и т. п.) c data.yaml; классы
              переводятся по maps/keywords.yaml или явной карте --map
  astana    — наши фото контейнеров Астаны, размеченные в CVAT / Label Studio
              (экспорт YOLO 1.1) — идут ТОЛЬКО в отдельный test_astana (проверка качества)

Примеры:
  python training/prepare.py taco     --src data/raw/TACO/data      --out data/work
  python training/prepare.py trashnet --src data/raw/trashnet       --out data/work
  python training/prepare.py yolo     --src data/raw/rf-waste       --out data/work --name rf_waste
  python training/prepare.py astana   --src data/raw/astana_yolo    --out data/work
  python training/prepare.py split    --work data/work --out data/merged   # 80/10/10 + data.yaml
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
RULES = HERE.parents[1] / "contracts" / "waste-rules.json"
CLASSES: list[str] = [c["ai_class"] for c in sorted(json.loads(RULES.read_text(encoding="utf-8"))["classes"], key=lambda c: c["id"])]
CID = {c: i for i, c in enumerate(CLASSES)}
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def load_map(name: str) -> dict:
    return yaml.safe_load((HERE / "maps" / f"{name}.yaml").read_text(encoding="utf-8"))


def keyword_class(name: str, rules: list[list[str]]) -> str | None:
    n = name.lower().replace("_", " ").replace("-", " ")
    for kw, cls in rules:
        if kw.lower().replace("_", " ").replace("-", " ") in n:
            return cls
    return None


def file_hash(p: Path) -> str:
    h = hashlib.sha1()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def write_sample(out: Path, source: str, img: Path, lines: list[str], stats: Counter) -> None:
    """Кладёт пару изображение + YOLO-разметку в out/<source>/{images,labels}."""
    if not lines:
        return
    key = file_hash(img)
    (out / source / "images").mkdir(parents=True, exist_ok=True)
    (out / source / "labels").mkdir(parents=True, exist_ok=True)
    dst = out / source / "images" / f"{source}_{key}{img.suffix.lower()}"
    if not dst.exists():
        shutil.copy2(img, dst)
    (out / source / "labels" / f"{source}_{key}.txt").write_text("\n".join(lines) + "\n")
    for ln in lines:
        stats[CLASSES[int(ln.split()[0])]] += 1


def yolo_line(cls: str, x: float, y: float, w: float, h: float, iw: float, ih: float) -> str | None:
    """COCO-рамка (x, y, w, h в пикселях) → строка YOLO (нормированные cx, cy, w, h)."""
    if w <= 1 or h <= 1 or iw <= 0 or ih <= 0:
        return None
    cx, cy = (x + w / 2) / iw, (y + h / 2) / ih
    nw, nh = w / iw, h / ih
    cx, cy, nw, nh = (min(max(v, 0.0), 1.0) for v in (cx, cy, nw, nh))
    return f"{CID[cls]} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}"


# ---------------------------------------------------------------- TACO (COCO)
def prep_taco(src: Path, out: Path, name: str = "taco") -> Counter:
    m = load_map("taco")
    ann_file = next((p for p in [src / "annotations_merged.json", src / "annotations.json", *src.glob("*.json")] if p.exists()), None)
    if not ann_file:
        sys.exit(f"нет annotations.json в {src}")
    coco = json.loads(ann_file.read_text(encoding="utf-8"))
    cats = {c["id"]: m.get(c["name"]) for c in coco["categories"]}
    unknown = [c["name"] for c in coco["categories"] if c["name"] not in m]
    if unknown:
        print("⚠ нет в карте TACO (пропущены):", unknown)
    imgs = {i["id"]: i for i in coco["images"]}
    by_img: dict[int, list[str]] = defaultdict(list)
    for a in coco["annotations"]:
        cls = cats.get(a["category_id"])
        im = imgs[a["image_id"]]
        if cls:
            ln = yolo_line(cls, *a["bbox"], im["width"], im["height"])
            if ln:
                by_img[a["image_id"]].append(ln)
    stats: Counter = Counter()
    for iid, lines in by_img.items():
        p = src / imgs[iid]["file_name"]
        if p.exists():
            write_sample(out, name, p, lines, stats)
    return stats


# ---------------------------------------------------------------- TrashNet
def prep_trashnet(src: Path, out: Path, name: str = "trashnet", margin: float = 0.03) -> Counter:
    m = load_map("trashnet")
    stats: Counter = Counter()
    for folder in sorted(p for p in src.iterdir() if p.is_dir()):
        cls = m.get(folder.name.lower())
        if not cls:
            continue
        for p in folder.iterdir():
            if p.suffix.lower() in IMG_EXT:
                w = h = 1 - 2 * margin
                write_sample(out, name, p, [f"{CID[cls]} 0.5 0.5 {w:.4f} {h:.4f}"], stats)
    return stats


# ---------------------------------------------------------------- YOLO / Roboflow
def prep_yolo(src: Path, out: Path, name: str, explicit_map: Path | None = None) -> Counter:
    data_yaml = next(iter(src.glob("data.y*ml")), None)
    if not data_yaml:
        sys.exit(f"нет data.yaml в {src}")
    cfg = yaml.safe_load(data_yaml.read_text(encoding="utf-8"))
    names = cfg["names"]
    names = [names[k] for k in sorted(names)] if isinstance(names, dict) else list(names)
    if explicit_map:
        mp = yaml.safe_load(explicit_map.read_text(encoding="utf-8"))
        remap = {i: mp.get(n) for i, n in enumerate(names)}
    else:
        kw = load_map("keywords")
        remap = {i: (n if n in CID else keyword_class(n, kw)) for i, n in enumerate(names)}
    print("карта классов:", {names[i]: c for i, c in remap.items()})
    stats: Counter = Counter()
    for lbl in src.rglob("labels/**/*.txt"):
        img = None
        for ext in IMG_EXT:
            cand = Path(str(lbl).replace("/labels/", "/images/")).with_suffix(ext)
            if cand.exists():
                img = cand
                break
        if not img:
            continue
        lines = []
        for row in lbl.read_text().split("\n"):
            parts = row.split()
            if len(parts) < 5:
                continue
            cls = remap.get(int(parts[0]))
            if cls:
                if len(parts) > 5:  # полигон сегментации → рамка
                    xs, ys = [float(v) for v in parts[1::2]], [float(v) for v in parts[2::2]]
                    x1, x2, y1, y2 = min(xs), max(xs), min(ys), max(ys)
                    parts = [parts[0], (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1]
                lines.append(f"{CID[cls]} " + " ".join(f"{float(v):.6f}" for v in parts[1:5]))
        write_sample(out, name, img, lines, stats)
    return stats


# ---------------------------------------------------------------- сплит 80/10/10
def split(work: Path, out: Path, seed: int = 42, ratios=(0.8, 0.1, 0.1)) -> None:
    rng = random.Random(seed)
    samples: list[tuple[Path, Path]] = []
    seen: set[str] = set()
    astana: list[tuple[Path, Path]] = []
    for src in sorted(p for p in work.iterdir() if p.is_dir()):
        for img in sorted((src / "images").iterdir()):
            lbl = src / "labels" / (img.stem + ".txt")
            key = img.stem.split("_", 1)[-1]
            if not lbl.exists() or key in seen:  # дубликаты между датасетами — по хэшу файла
                continue
            seen.add(key)
            (astana if src.name == "astana" else samples).append((img, lbl))
    rng.shuffle(samples)
    n = len(samples)
    n_train, n_val = int(n * ratios[0]), int(n * ratios[1])
    parts = {"train": samples[:n_train], "val": samples[n_train:n_train + n_val], "test": samples[n_train + n_val:],
             "test_astana": astana}
    for part, items in parts.items():
        (out / "images" / part).mkdir(parents=True, exist_ok=True)
        (out / "labels" / part).mkdir(parents=True, exist_ok=True)
        for img, lbl in items:
            shutil.copy2(img, out / "images" / part / img.name)
            shutil.copy2(lbl, out / "labels" / part / lbl.name)
    data = {"path": str(out.resolve()), "train": "images/train", "val": "images/val", "test": "images/test",
            "names": dict(enumerate(CLASSES))}
    (out / "data.yaml").write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False))
    if astana:
        (out / "data_astana.yaml").write_text(yaml.safe_dump({**data, "val": "images/test_astana", "test": "images/test_astana"},
                                                              allow_unicode=True, sort_keys=False))
    counts = Counter()
    for _, lbl in parts["train"]:
        for row in lbl.read_text().split("\n"):
            if row.strip():
                counts[CLASSES[int(row.split()[0])]] += 1
    report = {"total": n, **{k: len(v) for k, v in parts.items()}, "train_boxes_per_class": dict(counts)}
    (out / "split_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    missing = [c for c in CLASSES if counts[c] == 0]
    if missing:
        print("⚠ классы без примеров в train:", missing, "— добавьте датасеты Roboflow или свои фото")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for cmd in ("taco", "trashnet", "yolo", "astana"):
        p = sub.add_parser(cmd)
        p.add_argument("--src", type=Path, required=True)
        p.add_argument("--out", type=Path, default=Path("data/work"))
        p.add_argument("--name", default=cmd)
        p.add_argument("--map", type=Path, help="явная карта классов YAML {их_класс: наш_класс}")
    p = sub.add_parser("split")
    p.add_argument("--work", type=Path, default=Path("data/work"))
    p.add_argument("--out", type=Path, default=Path("data/merged"))
    p.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    if a.cmd == "split":
        split(a.work, a.out, a.seed)
        return
    fn = {"taco": lambda: prep_taco(a.src, a.out, a.name), "trashnet": lambda: prep_trashnet(a.src, a.out, a.name),
          "yolo": lambda: prep_yolo(a.src, a.out, a.name, a.map), "astana": lambda: prep_yolo(a.src, a.out, "astana", a.map)}[a.cmd]
    stats = fn()
    print(f"{a.cmd}: {sum(stats.values())} рамок", dict(stats))


if __name__ == "__main__":
    main()
