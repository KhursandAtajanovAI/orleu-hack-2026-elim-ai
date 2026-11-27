#!/usr/bin/env python3
"""Офлайн-аугментации под Астану (ТЗ 6.2): снег, ночь, размытие, пересвет.

Ultralytics и так делает HSV/яркость/масштаб/мозаику на лету; здесь — то, чего
в нём нет: снег и ночная съёмка со вспышкой. Создаёт копии части train-выборки
с теми же рамками (геометрия не меняется).

  python training/augment_weather.py --data data/merged --fraction 0.25
"""
from __future__ import annotations

import argparse
import random
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def snow(a: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    h, w, _ = a.shape
    out = a.astype(np.float32) * 0.85 + 30            # белёсая дымка
    n = int(h * w * rng.uniform(0.002, 0.006))
    ys, xs = rng.integers(0, h, n), rng.integers(0, w, n)
    r = rng.integers(1, 4, n)
    for y, x, rr in zip(ys, xs, r):
        out[max(0, y - rr):y + rr, max(0, x - rr):x + rr] = 245
    return out.clip(0, 255).astype(np.uint8)


def night(a: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    h, w, _ = a.shape
    yy, xx = np.mgrid[0:h, 0:w]
    cy, cx = h * rng.uniform(0.35, 0.65), w * rng.uniform(0.35, 0.65)
    d = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2) / max(h, w)
    flash = np.clip(1.3 - 2.2 * d, 0.15, 1.2)[..., None]   # пятно вспышки, тёмные края
    out = a.astype(np.float32) * flash * rng.uniform(0.35, 0.6)
    out[..., 2] *= 1.1                                       # холодный оттенок
    out += rng.normal(0, 8, a.shape)                         # шум матрицы
    return out.clip(0, 255).astype(np.uint8)


def blur(img: Image.Image, rng: np.random.Generator) -> Image.Image:
    return img.filter(ImageFilter.GaussianBlur(radius=float(rng.uniform(1.0, 2.5))))


def overexpose(a: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    return (a.astype(np.float32) * rng.uniform(1.3, 1.7) + 20).clip(0, 255).astype(np.uint8)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=Path("data/merged"))
    ap.add_argument("--fraction", type=float, default=0.25)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    rnd = random.Random(a.seed)
    imgs = sorted((a.data / "images" / "train").glob("*"))
    imgs = [p for p in imgs if "_aug-" not in p.stem]
    chosen = rnd.sample(imgs, int(len(imgs) * a.fraction)) if imgs else []
    kinds = ["snow", "night", "blur", "overexpose"]
    for p in chosen:
        k = rnd.choice(kinds)
        img = Image.open(p).convert("RGB")
        arr = np.asarray(img)
        res = {"snow": lambda: Image.fromarray(snow(arr, rng)), "night": lambda: Image.fromarray(night(arr, rng)),
               "blur": lambda: blur(img, rng), "overexpose": lambda: Image.fromarray(overexpose(arr, rng))}[k]()
        dst = p.with_name(f"{p.stem}_aug-{k}.jpg")
        res.save(dst, quality=90)
        lbl = a.data / "labels" / "train" / f"{p.stem}.txt"
        if lbl.exists():
            shutil.copy2(lbl, lbl.with_name(f"{p.stem}_aug-{k}.txt"))
    print(f"добавлено {len(chosen)} аугментированных фото")


if __name__ == "__main__":
    main()
