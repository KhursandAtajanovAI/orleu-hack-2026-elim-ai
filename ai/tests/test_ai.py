"""Тесты ИИ-сервиса: формула чистоты, качество фото, постобработка, API и ошибки."""
from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from app.analyze import analyze, contamination
from app.detector import Detector, letterbox, nms, parse_names
from app.errors import AiError
from app.quality import check, decode_image, measure
from app.ratelimit import RateLimiter
from app.rules import load_rules

from .conftest import RULES, jpeg_bytes


@pytest.fixture(scope="module")
def rules():
    return load_rules(str(RULES))


# ---------------------------------------------------------------- правила
def test_13_classes_and_bins(rules):
    assert len(rules.classes) == 13
    assert rules.get("pet_bottle").bin == "plastic"
    assert rules.get("cardboard").bin == "paper"
    assert rules.get("unknown-class").ai_class == "other"


def test_fits(rules):
    assert rules.fits("pet_bottle", "plastic")
    assert not rules.fits("organic", "plastic")
    assert rules.fits("organic", "mixed")
    assert not rules.fits("hazardous", "mixed"), "батарейки — ни в один контейнер"


# ---------------------------------------------------------------- формула
def test_contamination_formula():
    items = [{"_area": 200.0, "correct": True}, {"_area": 100.0, "correct": False}]
    assert contamination(items) == pytest.approx(33.3)
    assert contamination([]) is None
    assert contamination([{"_area": 10.0, "correct": True}]) == 0


# ---------------------------------------------------------------- геометрия
def test_nms_removes_overlaps():
    boxes = np.array([[0, 0, 10, 10], [1, 1, 11, 11], [50, 50, 60, 60]], dtype=np.float32)
    scores = np.array([0.9, 0.8, 0.7], dtype=np.float32)
    assert nms(boxes, scores, 0.45) == [0, 2]


def test_letterbox_keeps_aspect():
    x, r, (px, py) = letterbox(Image.new("RGB", (1280, 640)), 640)
    assert x.shape == (1, 3, 640, 640)
    assert r == 0.5 and px == 0 and py == 160


def test_parse_names():
    assert parse_names({"names": "{0: 'pet_bottle', 1: 'film'}"}) == ["pet_bottle", "film"]
    assert parse_names({}) is None


# ---------------------------------------------------------------- качество
def test_decode_resizes_and_rejects_garbage():
    img = decode_image(jpeg_bytes(2000, 1000), 1280)
    assert img.size == (1280, 640)
    with pytest.raises(AiError) as e:
        decode_image(b"not an image", 1280)
    assert e.value.code == "IMAGE_UNREADABLE"


def test_dark_and_blurry_detected():
    with pytest.raises(AiError) as e:
        check(measure(decode_image(jpeg_bytes(brightness=10, noise=3), 1280)), 35, 12)
    assert e.value.code == "IMAGE_TOO_DARK"
    flat = io.BytesIO()
    Image.new("RGB", (400, 400), (128, 128, 128)).save(flat, format="PNG")
    with pytest.raises(AiError) as e:
        check(measure(decode_image(flat.getvalue(), 1280)), 35, 12)
    assert e.value.code == "IMAGE_TOO_BLURRY"


# ---------------------------------------------------------------- конвейер
def test_container_mode_contamination(model_path, rules, img):
    det = Detector(str(model_path))
    r = analyze(img, detector=det, rules=rules, mode="container", container_type="plastic")
    assert r["model_version"] == "waste-yolo-test"
    assert [i["class"] for i in r["items"]] == ["pet_bottle", "organic"], "NMS убрал дубль, порог — слабую рамку"
    pet, org = r["items"]
    assert pet["correct"] is True and org["correct"] is False
    assert pet["box"] == [150, 100, 250, 300]
    # 100×200 подходит, 100×100 — нет → 10000 / 30000
    assert r["contamination_pct"] == pytest.approx(33.3)
    assert any("Органика" in t for t in r["tips"])
    assert r["processing_ms"] >= 0


def test_item_mode_primary(model_path, rules, img):
    r = analyze(img, detector=Detector(str(model_path)), rules=rules, mode="item")
    assert r["primary"]["class"] == "pet_bottle"
    assert r["primary"]["bin"] == "plastic"
    assert r["contamination_pct"] is None
    assert r["items"][0]["correct"] is None


def test_threshold_configurable(model_path, rules, img):
    r = analyze(img, detector=Detector(str(model_path)), rules=rules, mode="item", conf=0.1)
    assert "glass" in [i["class"] for i in r["items"]]


def test_nothing_found(model_path, rules, img):
    with pytest.raises(AiError) as e:
        analyze(img, detector=Detector(str(model_path)), rules=rules, mode="item", conf=0.99)
    assert e.value.code == "NOTHING_FOUND"


def test_coco_bootstrap_maps_classes(coco_model_path, rules, img):
    r = analyze(img, detector=Detector(str(coco_model_path)), rules=rules, mode="item")
    assert [i["class"] for i in r["items"]] == ["pet_bottle"], "человек отброшен, bottle → ПЭТ"
    assert r["model_version"].endswith("-coco")


def test_rate_limiter():
    rl = RateLimiter(2)
    assert rl.allow("u", 0) and rl.allow("u", 1)
    assert not rl.allow("u", 2)
    assert rl.allow("v", 2)
    assert rl.allow("u", 62)


# ---------------------------------------------------------------- HTTP API
def test_health(client):
    j = client.get("/ai/health").json()
    assert j["status"] == "ok" and j["model_loaded"]
    assert j["model_version"] == "waste-yolo-test"
    assert len(j["classes"]) == 13


def test_analyze_endpoint(client, img):
    res = client.post("/ai/analyze", files={"image": ("a.jpg", img, "image/jpeg")},
                      data={"mode": "container", "container_type": "plastic"})
    assert res.status_code == 200, res.text
    j = res.json()
    for k in ("model_version", "items", "contamination_pct", "tips", "processing_ms"):
        assert k in j
    assert j["items"][0] | {} == j["items"][0]
    assert set(j["items"][0]) >= {"class", "label_ru", "confidence", "box", "bin", "correct"}


def test_error_format(client):
    res = client.post("/ai/analyze", files={"image": ("a.jpg", b"xxx", "image/jpeg")})
    assert res.status_code == 422
    assert res.json() == {"error": {"code": "IMAGE_UNREADABLE", "message": res.json()["error"]["message"]}}
    res = client.post("/ai/analyze", data={"mode": "item"})
    assert res.status_code == 400 and res.json()["error"]["code"] == "VALIDATION"
    res = client.post("/ai/analyze", files={"image": ("a.jpg", jpeg_bytes(), "image/jpeg")}, data={"mode": "container"})
    assert res.status_code == 400


def test_rate_limit_http(client, img):
    codes = [client.post("/ai/analyze", files={"image": ("a.jpg", img, "image/jpeg")}, headers={"X-User-Id": "spam"}).status_code
             for _ in range(7)]
    assert codes.count(429) >= 1


def test_api_key(model_path, monkeypatch, img):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("MODEL_PATH", str(model_path))
    monkeypatch.setenv("AI_API_KEY", "secret")
    from app.main import app

    with TestClient(app) as c:
        assert c.post("/ai/analyze", files={"image": ("a.jpg", img, "image/jpeg")}).status_code == 401
        ok = c.post("/ai/analyze", files={"image": ("a.jpg", img, "image/jpeg")}, headers={"X-AI-Key": "secret"})
        assert ok.status_code == 200


def test_degraded_without_model(monkeypatch, tmp_path, img):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("MODEL_PATH", str(tmp_path / "missing.onnx"))
    monkeypatch.delenv("MODEL_URL", raising=False)
    monkeypatch.delenv("AI_API_KEY", raising=False)
    from app.main import app

    with TestClient(app) as c:
        assert c.get("/ai/health").json()["status"] == "degraded"
        r = c.post("/ai/analyze", files={"image": ("a.jpg", img, "image/jpeg")})
        assert r.status_code == 503 and r.json()["error"]["code"] == "MODEL_NOT_LOADED"


def test_speed_1280px_cpu(client):
    """Критерий 6.4: ответ на CPU ≤ 3 с для изображения 1280 px (здесь — накладные расходы сервиса)."""
    data = jpeg_bytes(1280, 960, seed=3)
    res = client.post("/ai/analyze", files={"image": ("a.jpg", data, "image/jpeg")}, headers={"X-User-Id": "speed"})
    assert res.status_code == 200
    assert res.json()["processing_ms"] < 3000
