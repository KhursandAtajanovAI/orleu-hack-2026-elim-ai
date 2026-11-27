"""Обработка (ТЗ 6.3): детекция → фильтр по уверенности → сопоставление классов
с waste_rules → расчёт чистоты.

Загрязнение контейнера = суммарная площадь рамок предметов «не для этого
контейнера» / площадь всех рамок × 100%.
"""
from __future__ import annotations

import time
from typing import Iterable

from .coco_map import COCO_TO_WASTE
from .detector import Detection, Detector
from .errors import AiError
from .quality import check, decode_image, measure
from .rules import WASTE_TYPES, Rules


def map_class(name: str, class_map: str, known: set[str]) -> str | None:
    """Класс модели → наш класс. None — объект не относится к отходам (отбросить)."""
    if class_map == "coco":
        return COCO_TO_WASTE.get(name)
    if name in known:
        return name
    return "other" if class_map == "native" else None


def detect_class_map(names: Iterable[str], known: set[str]) -> str:
    names = set(names)
    if names and names <= known | {"other"}:
        return "native"
    if {"person", "bottle", "car"} <= names:
        return "coco"
    return "native"


def contamination(items: list[dict]) -> float | None:
    total = sum(i["_area"] for i in items)
    if total <= 0:
        return None
    wrong = sum(i["_area"] for i in items if i["correct"] is False)
    return round(100.0 * wrong / total, 1)


def build_tips(items: list[dict], rules: Rules, mode: str, container_type: str | None, lang: str = "ru") -> list[str]:
    tips: list[str] = []
    seen: set[str] = set()
    key = "hint_kk" if lang == "kk" else "hint_ru"
    if mode == "container" and container_type:
        wrong = [i for i in items if i["correct"] is False]
        for i in wrong:
            r = rules.get(i["class"])
            if r.ai_class in seen:
                continue
            seen.add(r.ai_class)
            label = r.label_kk if lang == "kk" else r.label_ru
            if r.special_handling:
                tips.append(getattr(r, key))
            else:
                bin_label = rules.bins[r.bin]["label_kk" if lang == "kk" else "label_ru"]
                tips.append(f"{label} → {bin_label}" if lang == "kk" else f"{label} — в контейнер «{bin_label}»")
        if not wrong and items:
            tips.append("Отлично! Контейнер заполнен правильно" if lang != "kk" else "Керемет! Контейнер дұрыс толтырылған")
    for i in items:
        r = rules.get(i["class"])
        if r.ai_class in seen or not getattr(r, key):
            continue
        seen.add(r.ai_class)
        tips.append(getattr(r, key))
        if len(tips) >= 4:
            break
    return tips[:4]


def analyze(
    data: bytes,
    *,
    detector: Detector,
    rules: Rules,
    mode: str = "item",
    container_type: str | None = None,
    conf: float = 0.35,
    iou: float = 0.45,
    max_side: int = 1280,
    max_det: int = 100,
    min_brightness: float = 35.0,
    min_sharpness: float = 12.0,
    class_map: str = "auto",
    model_version: str | None = None,
    lang: str = "ru",
) -> dict:
    t0 = time.perf_counter()
    if mode not in ("item", "container"):
        raise AiError(400, "VALIDATION", "mode: item или container")
    if mode == "container":
        if container_type not in WASTE_TYPES:
            raise AiError(400, "VALIDATION", "Для режима «контейнер» нужен container_type: " + ", ".join(WASTE_TYPES))
    elif container_type is not None and container_type not in WASTE_TYPES:
        raise AiError(400, "VALIDATION", "container_type: " + ", ".join(WASTE_TYPES))

    img = decode_image(data, max_side)
    q = measure(img)
    check(q, min_brightness, min_sharpness)

    known = set(rules.classes)
    cmap = class_map if class_map != "auto" else detect_class_map(detector.names, known)
    dets: list[Detection] = detector.detect(img, conf=conf, iou=iou, max_det=max_det)

    items: list[dict] = []
    for d in dets:
        cls = map_class(d.name, cmap, known)
        if cls is None:
            continue
        r = rules.get(cls)
        correct = rules.fits(cls, container_type) if (mode == "container" and container_type) else None
        x1, y1, x2, y2 = d.box
        items.append({
            "class": r.ai_class,
            "label_ru": r.label_ru,
            "label_kk": r.label_kk,
            "confidence": round(d.confidence, 3),
            "box": [round(x1), round(y1), round(x2), round(y2)],
            "bin": r.bin,
            "correct": correct,
            "special_handling": r.special_handling,
            "color": r.color,
            "_area": d.area,
        })
    items.sort(key=lambda i: -i["confidence"])

    if not items and mode == "item":
        raise AiError(422, "NOTHING_FOUND", "Ничего не найдено — поднесите предмет ближе и снимите на однотонном фоне")

    version = model_version or detector.version
    if cmap == "coco" and "coco" not in version:
        version += "-coco"

    result = {
        "model_version": version,
        "mode": mode,
        "container_type": container_type,
        "image": {"width": img.size[0], "height": img.size[1]},
        "items": [{k: v for k, v in i.items() if not k.startswith("_")} for i in items],
        # «предмет в руке»: пока нет отдельного классификатора (P1) — самый уверенный объект детектора
        "primary": ({k: v for k, v in items[0].items() if not k.startswith("_")} if items else None),
        "contamination_pct": contamination(items) if mode == "container" else None,
        "nothing_found": not items,
        "tips": build_tips(items, rules, mode, container_type, lang),
        "quality": {"brightness": q.brightness, "sharpness": q.sharpness},
        "processing_ms": int((time.perf_counter() - t0) * 1000),
    }
    return result
