"""Стартовая (bootstrap) модель: YOLO, предобученный на COCO, без дообучения.

ТЗ 6.2: «стартуем с открытой предобученной модели детекции». Пока дообученные
на TACO/TrashNet веса не готовы, сервис может работать на весах COCO: часть
классов COCO однозначно соответствует отходам. Ответ честно помечает версию
модели как «…-coco», а остальные классы COCO (люди, машины и т. п.)
отбрасываются. После дообучения (`training/`) карта не нужна — CLASS_MAP=native.
"""
from __future__ import annotations

COCO_TO_WASTE: dict[str, str] = {
    "bottle": "pet_bottle",
    "cup": "hard_plastic",
    "wine glass": "glass",
    "vase": "glass",
    "bowl": "hard_plastic",
    "toothbrush": "hard_plastic",
    "fork": "other",
    "knife": "other",
    "spoon": "other",
    "banana": "organic",
    "apple": "organic",
    "orange": "organic",
    "broccoli": "organic",
    "carrot": "organic",
    "sandwich": "organic",
    "hot dog": "organic",
    "pizza": "organic",
    "donut": "organic",
    "cake": "organic",
    "potted plant": "organic",
    "book": "paper",
    "teddy bear": "textile",
    "backpack": "textile",
    "handbag": "textile",
    "tie": "textile",
    "suitcase": "other",
    "umbrella": "other",
    "cell phone": "hazardous",   # электроника с аккумулятором — в пункт приёма
    "remote": "hazardous",
    "laptop": "hazardous",
    "mouse": "hazardous",
    "keyboard": "hazardous",
    "hair drier": "hazardous",
    "scissors": "other",
    "sports ball": "other",
    "frisbee": "hard_plastic",
}
