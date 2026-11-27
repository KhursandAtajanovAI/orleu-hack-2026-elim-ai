"""ИИ-сервис «Қайда?» — FastAPI + ONNX Runtime (ТЗ 6.3).

    POST /ai/analyze   — изображение + mode (item | container) + container_type
    GET  /ai/health    — состояние и версия модели
    GET  /ai/classes   — классы и правила «класс → контейнер»

Запуск: uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import time
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .analyze import analyze
from .config import Settings, get_settings
from .errors import AiError
from .ratelimit import RateLimiter
from .rules import load_rules

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("kaida.ai")


class State:
    settings: Settings
    detector = None
    model_error: str | None = None
    limiter: RateLimiter
    sem: asyncio.Semaphore
    started: float = time.time()
    requests: int = 0
    errors: int = 0


state = State()


def _download_model(url: str, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    log.info("скачиваю модель %s → %s", url, dst)
    tmp = dst.with_suffix(".part")
    with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:  # noqa: S310 — URL из настроек
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.replace(dst)


def load_model(settings: Settings) -> None:
    from .detector import Detector

    path = Path(settings.model_path)
    try:
        if not path.exists() and settings.model_url:
            _download_model(settings.model_url, path)
        if not path.exists():
            raise FileNotFoundError(f"нет файла модели {path} (задайте MODEL_PATH или MODEL_URL)")
        state.detector = Detector(str(path), threads=settings.intra_op_threads)
        state.model_error = None
    except Exception as e:  # сервис стартует и без модели: /ai/health покажет причину
        state.detector = None
        state.model_error = str(e)
        log.error("модель не загружена: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    state.settings = get_settings()
    state.limiter = RateLimiter(state.settings.rate_limit_per_min)
    state.sem = asyncio.Semaphore(max(1, state.settings.max_concurrency))
    await asyncio.to_thread(load_model, state.settings)
    yield


app = FastAPI(
    title="Қайда? — ИИ-сервис",
    version=__version__,
    description="Детекция отходов (YOLO → ONNX Runtime), сопоставление с waste_rules, расчёт чистоты контейнера.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",")],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _report(level: str, message: str, context: dict) -> None:
    """Ошибки ИИ-сервиса — в общий журнал app_logs (через RPC log_event Supabase), P1."""
    s = state.settings
    if not s.log_url:
        return
    body = json.dumps({"p_source": "ai", "p_level": level, "p_message": message, "p_context": context}).encode()
    req = urllib.request.Request(s.log_url, data=body, method="POST", headers={
        "Content-Type": "application/json", "apikey": s.log_key, "Authorization": f"Bearer {s.log_key}"})
    try:
        urllib.request.urlopen(req, timeout=3)  # noqa: S310
    except Exception:  # журнал не должен ронять сервис
        pass


@app.exception_handler(AiError)
async def ai_error_handler(_: Request, e: AiError):
    return JSONResponse(e.body(), status_code=e.status)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, e: RequestValidationError):
    first = e.errors()[0] if e.errors() else {}
    field = ".".join(str(x) for x in first.get("loc", []) if x not in ("body", "query"))
    return JSONResponse({"error": {"code": "VALIDATION", "message": f"{field}: {first.get('msg', 'ошибка данных')}"}}, status_code=400)


@app.exception_handler(StarletteHTTPException)
async def http_handler(_: Request, e: StarletteHTTPException):
    code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(e.status_code, "HTTP_ERROR")
    return JSONResponse({"error": {"code": code, "message": str(e.detail)}}, status_code=e.status_code)


@app.exception_handler(Exception)
async def unhandled(_: Request, e: Exception):
    state.errors += 1
    log.exception("необработанная ошибка")
    await asyncio.to_thread(_report, "error", str(e)[:500], {"type": type(e).__name__})
    return JSONResponse({"error": {"code": "INTERNAL", "message": "Внутренняя ошибка ИИ-сервиса"}}, status_code=500)


def _check_key(request: Request) -> None:
    key = state.settings.api_key
    if key and not hmac.compare_digest(request.headers.get("x-ai-key", ""), key):
        raise AiError(401, "UNAUTHORIZED", "Неверный X-AI-Key")


def _client_id(request: Request) -> str:
    # бэкенд передаёт id пользователя, иначе — IP
    return request.headers.get("x-user-id") or (request.client.host if request.client else "anon")


@app.get("/ai/health")
async def health():
    s = state.settings
    d = state.detector
    rules = load_rules(s.rules_path)
    return {
        "status": "ok" if d else "degraded",
        "service_version": __version__,
        "model_version": (s.model_version or (d.version if d else None)),
        "model_loaded": d is not None,
        "model_error": state.model_error,
        "model_classes": d.names if d else [],
        "classes": rules.classes,
        "providers": d.providers if d else [],
        "input_size": d.imgsz if d else None,
        "warmup_ms": d.warmup_ms if d else None,
        "conf_threshold": s.conf_threshold,
        "uptime_s": int(time.time() - state.started),
        "requests": state.requests,
        "errors": state.errors,
    }


@app.get("/ai/classes")
async def classes():
    rules = load_rules(state.settings.rules_path)
    return {"version": rules.version, "bins": rules.bins, "classes": [vars(r) for r in rules.by_class.values()]}


@app.post("/ai/analyze")
async def analyze_endpoint(
    request: Request,
    image: UploadFile = File(..., description="JPEG/PNG/WebP, до 1280 px по длинной стороне"),
    mode: str = Form("item"),
    container_type: str | None = Form(None),
    conf: float | None = Form(None, ge=0.01, le=0.99),
    lang: str = Form("ru"),
):
    _check_key(request)
    s = state.settings
    state.requests += 1
    if not state.limiter.allow(_client_id(request)):
        raise AiError(429, "RATE_LIMITED", f"Не больше {s.rate_limit_per_min} фото в минуту — подождите немного")
    if state.detector is None:
        raise AiError(503, "MODEL_NOT_LOADED", "Модель не загружена: " + (state.model_error or "неизвестная причина"))

    data = await image.read(s.max_upload_bytes + 1)
    if len(data) > s.max_upload_bytes:
        raise AiError(413, "IMAGE_TOO_LARGE", f"Файл больше {s.max_upload_bytes // (1024 * 1024)} МБ")

    # очередь запросов: не больше MAX_CONCURRENCY инференсов одновременно (P1)
    try:
        await asyncio.wait_for(state.sem.acquire(), timeout=s.queue_timeout_s)
    except asyncio.TimeoutError:
        raise AiError(503, "BUSY", "ИИ-сервис перегружен, повторите через несколько секунд") from None
    try:
        return await asyncio.to_thread(
            analyze, data, detector=state.detector, rules=load_rules(s.rules_path),
            mode=mode, container_type=container_type or None,
            conf=conf or s.conf_threshold, iou=s.iou_threshold, max_side=s.max_side, max_det=s.max_detections,
            min_brightness=s.min_brightness, min_sharpness=s.min_sharpness,
            class_map=s.class_map, model_version=s.model_version or None, lang=lang,
        )
    finally:
        state.sem.release()
