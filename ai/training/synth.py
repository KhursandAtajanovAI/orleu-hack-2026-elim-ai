#!/usr/bin/env python3
"""Синтетические фото для обучения (copy-paste), MVP вместо ещё не снятых фото Астаны.

Берёт предметы из УЖЕ разделённой train-выборки (data/merged/images/train), вырезает их
по рамкам и наклеивает по 2–6 штук на синтетический фон «улица Астаны»: снег, асфальт,
сухая трава, бетон у контейнерной площадки. Редкие классы (плёнка, тетрапак, текстиль,
опасные) берутся чаще, чтобы выровнять баланс. Рамки пишутся автоматически.

Только train: val/test остаются настоящими фото, поэтому метрики честные.
  python training/synth.py --data data/merged --n 1500
"""
from __future__ import annotations

import argparse
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

SIZE = 640


# ------------------------------------------------------------------ фоны
def _noise(rng: np.random.Generator, scale: int, amp: float) -> np.ndarray:
    small = rng.normal(0, amp, (SIZE // scale + 2, SIZE // scale + 2))
    img = Image.fromarray(((small - small.min()) / (np.ptp(small) + 1e-9) * 255).astype(np.uint8))
    return np.asarray(img.resize((SIZE, SIZE), Image.Resampling.BICUBIC), dtype=np.float32) / 255 - 0.5


def background(rng: np.random.Generator) -> Image.Image:
    kind = rng.choice(["snow", "asphalt", "grass", "concrete", "slush"])
    base = {"snow": (228, 232, 240), "asphalt": (78, 80, 84), "grass": (128, 118, 72),
            "concrete": (150, 148, 142), "slush": (120, 116, 110)}[kind]
    tex = _noise(rng, 64, 1) * 60 + _noise(rng, 8, 1) * 30 + rng.normal(0, 6, (SIZE, SIZE))
    a = np.stack([np.full((SIZE, SIZE), c, np.float32) for c in base], -1) + tex[..., None]
    # перепад освещения (тень от контейнера / фонарь)
    g = np.linspace(rng.uniform(0.7, 1.0), rng.uniform(0.9, 1.15), SIZE)[:, None, None]
    a = a * (g if rng.random() < 0.5 else g.transpose(1, 0, 2))
    if kind in ("snow", "slush") and rng.random() < 0.6:  # следы и грязь на снегу
        a[..., :] -= np.clip(_noise(rng, 16, 1), 0, None)[..., None] * 120
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


# ------------------------------------------------------------------ предметы
def object_bank(train: Path, max_per_class: int) -> dict[int, list[tuple[Path, tuple[float, float, float, float]]]]:
    bank: dict[int, list] = defaultdict(list)
    for lbl in sorted((train.parent.parent / "labels" / "train").glob("*.txt")):
        if lbl.stem.startswith("synth_") or "_aug-" in lbl.stem:
            continue
        img = next((p for p in (train / f"{lbl.stem}{e}" for e in (".jpg", ".jpeg", ".png", ".webp")) if p.exists()), None)
        if not img:
            continue
        for row in lbl.read_text().split("\n"):
            p = row.split()
            if len(p) == 5 and float(p[3]) * float(p[4]) > 0.002:
                bank[int(p[0])].append((img, tuple(map(float, p[1:]))))
    rnd = random.Random(0)
    for c in bank:
        rnd.shuffle(bank[c])
        bank[c] = bank[c][:max_per_class]
    return bank


def cut(img_path: Path, box, rng: np.random.Generator) -> Image.Image | None:
    im = Image.open(img_path).convert("RGB")
    w, h = im.size
    cx, cy, bw, bh = box
    x1, y1, x2, y2 = (cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h
    crop = im.crop((int(x1), int(y1), int(x2), int(y2)))
    if crop.width < 12 or crop.height < 12:
        return None
    a = np.asarray(crop, dtype=np.int16)
    if img_path.name.startswith("trashnet_"):
        # TrashNet снят на белом фоне — маска по отличию от цвета краёв
        border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
        d = np.abs(a - np.median(border, 0)).sum(-1)
        mask = Image.fromarray(((d > 45) * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(5))
    else:
        # в TACO предмет на сложном фоне — мягкий эллипс по рамке
        mask = Image.new("L", crop.size, 0)
        ImageDraw.Draw(mask).ellipse((crop.width * 0.04, crop.height * 0.04, crop.width * 0.96, crop.height * 0.96), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(max(1.0, min(crop.size) / 40)))
    if np.asarray(mask).mean() < 20:
        return None
    rgba = crop.convert("RGBA")
    rgba.putalpha(mask)
    return rgba


def compose(bank, weights, rng: np.random.Generator, rnd: random.Random) -> tuple[Image.Image, list[str]]:
    bg = background(rng)
    classes = list(bank)
    boxes: list[tuple[float, float, float, float]] = []
    lines: list[str] = []
    for _ in range(rnd.randint(2, 6)):
        c = rnd.choices(classes, weights=[weights[k] for k in classes])[0]
        src = rnd.choice(bank[c])
        obj = cut(src[0], src[1], rng)
        if obj is None:
            continue
        side = rng.uniform(0.12, 0.45) * SIZE
        k = side / max(obj.size)
        obj = obj.resize((max(8, int(obj.width * k)), max(8, int(obj.height * k))), Image.Resampling.BILINEAR)
        if rnd.random() < 0.5:
            obj = obj.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        obj = obj.rotate(rng.uniform(-25, 25), expand=True, resample=Image.Resampling.BILINEAR)
        rgb = ImageEnhance.Brightness(obj.convert("RGB")).enhance(rng.uniform(0.7, 1.2))
        obj = Image.merge("RGBA", (*rgb.split(), obj.getchannel("A")))
        bbox = obj.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox()
        if not bbox:
            continue
        for _try in range(10):
            x = int(rng.uniform(0, SIZE - obj.width)) if obj.width < SIZE else 0
            y = int(rng.uniform(0, SIZE - obj.height)) if obj.height < SIZE else 0
            b = (x + bbox[0], y + bbox[1], x + bbox[2], y + bbox[3])
            if all(_iou(b, o) < 0.15 for o in boxes):
                break
        else:
            continue
        bg.paste(obj, (x, y), obj)
        boxes.append(b)
        x1, y1, x2, y2 = (max(0, min(SIZE, v)) for v in b)
        if x2 - x1 > 4 and y2 - y1 > 4:
            lines.append(f"{c} {(x1 + x2) / 2 / SIZE:.6f} {(y1 + y2) / 2 / SIZE:.6f} {(x2 - x1) / SIZE:.6f} {(y2 - y1) / SIZE:.6f}")
    # тень/снегопад/камера телефона
    bg = bg.filter(ImageFilter.GaussianBlur(rng.uniform(0, 0.8)))
    return bg, lines


def _iou(a, b) -> float:
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter + 1e-9)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=Path("data/merged"))
    ap.add_argument("--n", type=int, default=1500)
    ap.add_argument("--max-per-class", type=int, default=600)
    ap.add_argument("--seed", type=int, default=11)
    a = ap.parse_args()
    rng, rnd = np.random.default_rng(a.seed), random.Random(a.seed)
    train = a.data / "images" / "train"
    bank = object_bank(train, a.max_per_class)
    if not bank:
        raise SystemExit("в train нет предметов — сначала prepare.py split")
    counts = {c: len(v) for c, v in bank.items()}
    weights = {c: 1 / np.sqrt(n) for c, n in counts.items()}  # редкие классы — чаще
    stats: Counter = Counter()
    made = 0
    for i in range(a.n):
        img, lines = compose(bank, weights, rng, rnd)
        if not lines:
            continue
        img.save(train / f"synth_{i:05d}.jpg", quality=88)
        (a.data / "labels" / "train" / f"synth_{i:05d}.txt").write_text("\n".join(lines) + "\n")
        stats.update(int(ln.split()[0]) for ln in lines)
        made += 1
    rep = {"images": made, "objects_per_class": {str(k): v for k, v in sorted(stats.items())},
           "bank_per_class": {str(k): v for k, v in sorted(counts.items())}}
    (a.data / "synth_report.json").write_text(json.dumps(rep, indent=2))
    print(json.dumps(rep, indent=2))


if __name__ == "__main__":
    main()
