"""Справочник «класс ИИ → контейнер» (waste_rules).

Соответствие хранится вне модели (ТЗ 6.1): по умолчанию — contracts/waste-rules.json,
тот же файл, из которого генерируется сид таблицы waste_rules. Город может
переопределить правила — тогда бэкенд передаёт свои в WASTE_RULES_PATH.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

WASTE_TYPES = ("mixed", "plastic", "paper", "glass", "metal", "organic")


@dataclass(frozen=True)
class Rule:
    id: int
    ai_class: str
    label_ru: str
    label_kk: str
    bin: str
    is_recyclable: bool
    special_handling: bool
    hint_ru: str
    hint_kk: str
    color: str


class Rules:
    def __init__(self, data: dict):
        bins = data["bins"]
        self.version = data.get("version", 1)
        self.bins = bins
        self.by_class: dict[str, Rule] = {}
        self.classes: list[str] = []
        for c in sorted(data["classes"], key=lambda c: c["id"]):
            r = Rule(
                id=c["id"], ai_class=c["ai_class"], label_ru=c["label_ru"], label_kk=c["label_kk"],
                bin=c["bin"], is_recyclable=c["is_recyclable"], special_handling=c.get("special_handling", False),
                hint_ru=c.get("hint_ru", ""), hint_kk=c.get("hint_kk", ""), color=bins[c["bin"]]["color"],
            )
            self.by_class[r.ai_class] = r
            self.classes.append(r.ai_class)

    def get(self, ai_class: str) -> Rule:
        return self.by_class.get(ai_class) or self.by_class["other"]

    def fits(self, ai_class: str, container_type: str) -> bool:
        """Подходит ли предмет для контейнера данного типа."""
        r = self.get(ai_class)
        if r.special_handling:          # батарейки и лампы — ни в один контейнер
            return False
        if container_type == "mixed":   # в смешанный можно всё, кроме опасного
            return True
        return r.bin == container_type


@lru_cache(maxsize=4)
def load_rules(path: str) -> Rules:
    return Rules(json.loads(Path(path).read_text(encoding="utf-8")))
