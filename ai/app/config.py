"""Настройки ИИ-сервиса — только из переменных окружения (ключи не в коде)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _default_rules_path() -> str:
    # в Docker файл кладётся рядом с приложением, в репозитории — в contracts/
    for p in (ROOT / "waste-rules.json", ROOT.parent / "contracts" / "waste-rules.json"):
        if p.exists():
            return str(p)
    return str(ROOT / "waste-rules.json")


@dataclass(frozen=True)
class Settings:
    model_path: str = field(default_factory=lambda: _env("MODEL_PATH", str(ROOT / "models" / "model.onnx")))
    model_url: str = field(default_factory=lambda: _env("MODEL_URL", ""))
    # Имя версии модели сохраняется в каждом ответе и в scans/pickups (ТЗ 6.2).
    # Если пусто — берётся из метаданных ONNX (model_version) или имени файла.
    model_version: str = field(default_factory=lambda: _env("MODEL_VERSION", ""))
    # Классы модели → наши классы. "native" — модель обучена на наших 13 классах;
    # "coco" — стартовая COCO-модель до дообучения (см. app/coco_map.py).
    class_map: str = field(default_factory=lambda: _env("CLASS_MAP", "auto"))
    conf_threshold: float = field(default_factory=lambda: _float("CONF_THRESHOLD", 0.35))
    iou_threshold: float = field(default_factory=lambda: _float("IOU_THRESHOLD", 0.45))
    max_detections: int = field(default_factory=lambda: _int("MAX_DETECTIONS", 100))
    max_side: int = field(default_factory=lambda: _int("MAX_SIDE", 1280))
    max_upload_bytes: int = field(default_factory=lambda: _int("MAX_UPLOAD_BYTES", 8 * 1024 * 1024))
    min_brightness: float = field(default_factory=lambda: _float("MIN_BRIGHTNESS", 35.0))
    min_sharpness: float = field(default_factory=lambda: _float("MIN_SHARPNESS", 12.0))
    rules_path: str = field(default_factory=lambda: _env("WASTE_RULES_PATH", _default_rules_path()))
    api_key: str = field(default_factory=lambda: _env("AI_API_KEY", ""))
    rate_limit_per_min: int = field(default_factory=lambda: _int("RATE_LIMIT_PER_MIN", 30))
    max_concurrency: int = field(default_factory=lambda: _int("MAX_CONCURRENCY", 2))
    queue_timeout_s: float = field(default_factory=lambda: _float("QUEUE_TIMEOUT_S", 10.0))
    intra_op_threads: int = field(default_factory=lambda: _int("ORT_THREADS", 0))
    cors_origins: str = field(default_factory=lambda: _env("CORS_ORIGINS", "*"))
    log_url: str = field(default_factory=lambda: _env("LOG_URL", ""))  # Supabase RPC log_event (одно место для логов)
    log_key: str = field(default_factory=lambda: _env("LOG_KEY", ""))


def get_settings() -> Settings:
    return Settings()
