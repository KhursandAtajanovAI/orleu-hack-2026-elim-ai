"""Простая проверка качества фото (ТЗ 6.3): читаемость, яркость, резкость."""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import AiError

Image.MAX_IMAGE_PIXELS = 60_000_000  # защита от «бомб» распаковки


@dataclass
class Quality:
    brightness: float
    sharpness: float


def decode_image(data: bytes, max_side: int) -> Image.Image:
    """Читает JPEG/PNG/WebP, поворачивает по EXIF, уменьшает до max_side по длинной стороне."""
    if not data:
        raise AiError(422, "IMAGE_UNREADABLE", "Пустой файл")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise AiError(422, "IMAGE_UNREADABLE", "Не удалось прочитать изображение (нужен JPEG, PNG или WebP)") from None
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")
    w, h = img.size
    if w < 32 or h < 32:
        raise AiError(422, "IMAGE_UNREADABLE", "Изображение слишком маленькое")
    if max(w, h) > max_side:
        s = max_side / max(w, h)
        img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.Resampling.BILINEAR)
    return img


def measure(img: Image.Image) -> Quality:
    """Яркость — среднее серого 0..255; резкость — дисперсия лапласиана (на 512 px)."""
    g = img.convert("L")
    if max(g.size) > 512:
        s = 512 / max(g.size)
        g = g.resize((max(1, round(g.size[0] * s)), max(1, round(g.size[1] * s))), Image.Resampling.BILINEAR)
    a = np.asarray(g, dtype=np.float32)
    brightness = float(a.mean())
    lap = (-4 * a[1:-1, 1:-1] + a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:])
    sharpness = float(lap.var()) if lap.size else 0.0
    return Quality(brightness=round(brightness, 1), sharpness=round(sharpness, 1))


def check(q: Quality, min_brightness: float, min_sharpness: float) -> None:
    if q.brightness < min_brightness:
        raise AiError(422, "IMAGE_TOO_DARK", "Слишком темно — включите свет или вспышку", {"brightness": q.brightness})
    if q.sharpness < min_sharpness:
        raise AiError(422, "IMAGE_TOO_BLURRY", "Фото размыто — держите телефон неподвижно", {"sharpness": q.sharpness})
