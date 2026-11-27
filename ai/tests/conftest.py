"""Фикстуры: синтетическая ONNX-модель в формате выхода YOLO (без обучения и сети).

Модель игнорирует содержимое изображения и всегда «видит» заданные рамки —
так проверяется вся цепочка: letterbox → ONNX Runtime → NMS → классы →
waste_rules → чистота → JSON-ответ.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

RULES = ROOT.parent / "contracts" / "waste-rules.json"
CLASSES = [c["ai_class"] for c in sorted(json.loads(RULES.read_text())["classes"], key=lambda c: c["id"])]


def make_yolo_onnx(path: Path, names: list[str], preds: list[tuple[float, float, float, float, int, float]], imgsz: int = 640,
                   version: str = "waste-yolo-test") -> Path:
    """preds: (cx, cy, w, h, class_id, score) в пикселях входа imgsz."""
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    nc = len(names)
    out = np.zeros((1, 4 + nc, max(1, len(preds))), dtype=np.float32)
    for j, (cx, cy, w, h, c, s) in enumerate(preds):
        out[0, :4, j] = [cx, cy, w, h]
        out[0, 4 + c, j] = s
    const = numpy_helper.from_array(out, name="preds")
    nodes = [
        helper.make_node("ReduceMean", ["images"], ["m"], keepdims=0),
        helper.make_node("Mul", ["m", "zero"], ["z"]),
        helper.make_node("Add", ["preds", "z"], ["output0"]),
    ]
    graph = helper.make_graph(
        nodes, "fake_yolo",
        [helper.make_tensor_value_info("images", TensorProto.FLOAT, [1, 3, imgsz, imgsz])],
        [helper.make_tensor_value_info("output0", TensorProto.FLOAT, list(out.shape))],
        initializer=[const, numpy_helper.from_array(np.array(0, dtype=np.float32), name="zero")],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    for k, v in {"names": str(dict(enumerate(names))), "model_version": version, "imgsz": f"[{imgsz}, {imgsz}]"}.items():
        e = model.metadata_props.add()
        e.key, e.value = k, v
    onnx.checker.check_model(model)
    onnx.save(model, str(path))
    return path


PRED_DEFAULT = [
    (200, 200, 100, 200, CLASSES.index("pet_bottle"), 0.91),
    (205, 205, 100, 200, CLASSES.index("pet_bottle"), 0.80),   # дубль — уберёт NMS
    (450, 450, 100, 100, CLASSES.index("organic"), 0.70),
    (100, 500, 50, 50, CLASSES.index("glass"), 0.20),          # ниже порога 0.35
]


@pytest.fixture(scope="session")
def model_path(tmp_path_factory) -> Path:
    return make_yolo_onnx(tmp_path_factory.mktemp("m") / "model.onnx", CLASSES, PRED_DEFAULT)


@pytest.fixture(scope="session")
def coco_model_path(tmp_path_factory) -> Path:
    names = ["person", "bicycle", "car"] + ["x"] * 36 + ["bottle", "wine glass"]  # bottle = 39 как в COCO
    preds = [(150, 150, 80, 160, 0, 0.95), (300, 300, 60, 160, 39, 0.88)]
    return make_yolo_onnx(tmp_path_factory.mktemp("c") / "yolo11n.onnx", names, preds, version="yolo11n")


def jpeg_bytes(w: int = 640, h: int = 640, brightness: int = 128, noise: int = 60, seed: int = 0) -> bytes:
    rng = np.random.default_rng(seed)
    a = np.clip(rng.normal(brightness, noise, (h, w, 3)), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


@pytest.fixture()
def img() -> bytes:
    return jpeg_bytes()


@pytest.fixture()
def client(model_path, monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("MODEL_PATH", str(model_path))
    monkeypatch.setenv("WASTE_RULES_PATH", str(RULES))
    monkeypatch.setenv("RATE_LIMIT_PER_MIN", "5")
    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.delenv("MODEL_VERSION", raising=False)
    from app.main import app

    with TestClient(app) as c:
        yield c
