"""Детектор YOLO в формате ONNX на ONNX Runtime (CPU, GPU — по возможности).

Поддерживает оба формата экспорта Ultralytics:
  * классический  — выход [1, 4 + nc, N] (cx, cy, w, h, оценки классов), нужен NMS;
  * end-to-end    — выход [1, N, 6] (x1, y1, x2, y2, score, class), NMS уже внутри.
Имена классов берутся из метаданных ONNX (`names`), которые пишет Ultralytics.
"""
from __future__ import annotations

import ast
import logging
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

log = logging.getLogger("kaida.ai")


@dataclass
class Detection:
    cls: int
    name: str
    confidence: float
    box: tuple[float, float, float, float]  # x1, y1, x2, y2 в пикселях исходного изображения

    @property
    def area(self) -> float:
        x1, y1, x2, y2 = self.box
        return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def letterbox(img: Image.Image, size: int) -> tuple[np.ndarray, float, tuple[float, float]]:
    """Вписывает изображение в квадрат size×size с серыми полями (как в Ultralytics)."""
    w, h = img.size
    r = min(size / w, size / h)
    nw, nh = int(round(w * r)), int(round(h * r))
    resized = img.resize((nw, nh), Image.Resampling.BILINEAR)
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    pad_x, pad_y = (size - nw) / 2, (size - nh) / 2
    canvas.paste(resized, (int(round(pad_x - 0.1)), int(round(pad_y - 0.1))))
    arr = np.asarray(canvas, dtype=np.float32) / 255.0
    arr = arr.transpose(2, 0, 1)[None]  # 1×3×H×W
    return np.ascontiguousarray(arr), r, (int(round(pad_x - 0.1)), int(round(pad_y - 0.1)))


def nms(boxes: np.ndarray, scores: np.ndarray, iou: float) -> list[int]:
    """Классический NMS на numpy. boxes: N×4 (x1, y1, x2, y2)."""
    if len(boxes) == 0:
        return []
    x1, y1, x2, y2 = boxes.T
    areas = (x2 - x1).clip(0) * (y2 - y1).clip(0)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(x1[i], x1[rest])
        yy1 = np.maximum(y1[i], y1[rest])
        xx2 = np.minimum(x2[i], x2[rest])
        yy2 = np.minimum(y2[i], y2[rest])
        inter = (xx2 - xx1).clip(0) * (yy2 - yy1).clip(0)
        ov = inter / (areas[i] + areas[rest] - inter + 1e-9)
        order = rest[ov <= iou]
    return keep


def parse_names(meta: dict[str, str]) -> list[str] | None:
    raw = meta.get("names")
    if not raw:
        return None
    try:
        d = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return None
    if isinstance(d, dict):
        return [str(d[k]) for k in sorted(d, key=int)]
    if isinstance(d, (list, tuple)):
        return [str(x) for x in d]
    return None


class Detector:
    def __init__(self, path: str, threads: int = 0):
        import onnxruntime as ort  # импорт здесь — чтобы сервис стартовал и без модели

        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        if threads > 0:
            opts.intra_op_num_threads = threads
        available = ort.get_available_providers()
        providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in available]
        self.session = ort.InferenceSession(path, sess_options=opts, providers=providers)
        self.providers = self.session.get_providers()
        inp = self.session.get_inputs()[0]
        self.input_name = inp.name
        shape = inp.shape
        self.imgsz = int(shape[2]) if isinstance(shape[2], int) else 640
        meta = self.session.get_modelmeta().custom_metadata_map or {}
        self.meta = meta
        self.names = parse_names(meta) or []
        self.version = meta.get("model_version") or Path(path).stem
        # прогрев: первый запуск ONNX Runtime медленнее
        t = time.perf_counter()
        self.session.run(None, {self.input_name: np.zeros((1, 3, self.imgsz, self.imgsz), dtype=np.float32)})
        self.warmup_ms = int((time.perf_counter() - t) * 1000)
        log.info("модель %s загружена: %d классов, вход %d, %s, прогрев %d мс",
                 self.version, len(self.names), self.imgsz, self.providers, self.warmup_ms)

    def detect(self, img: Image.Image, conf: float, iou: float, max_det: int = 100) -> list[Detection]:
        x, r, (px, py) = letterbox(img, self.imgsz)
        out = self.session.run(None, {self.input_name: x})[0]
        out = np.asarray(out)
        if out.ndim == 3:
            out = out[0]
        dets: list[Detection] = []
        w, h = img.size

        if out.ndim == 2 and out.shape[1] == 6 and out.shape[0] != 6 and len(self.names) != 2:
            # end-to-end: N×6 (x1, y1, x2, y2, score, class)
            rows = out[out[:, 4] >= conf]
            boxes = rows[:, :4]
            scores = rows[:, 4]
            classes = rows[:, 5].astype(int)
            keep = list(range(len(rows)))
        else:
            # классический: (4 + nc)×N → N×(4 + nc)
            nc = len(self.names)
            if (nc and out.shape[0] == 4 + nc and out.shape[1] != 4 + nc) or (not nc and out.shape[0] < out.shape[1]):
                out = out.T
            cls_scores = out[:, 4:]
            classes = cls_scores.argmax(axis=1)
            scores = cls_scores[np.arange(len(cls_scores)), classes]
            mask = scores >= conf
            out, scores, classes = out[mask], scores[mask], classes[mask]
            cx, cy, bw, bh = out[:, 0], out[:, 1], out[:, 2], out[:, 3]
            boxes = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], axis=1)
            keep = []
            for c in np.unique(classes):  # NMS по классам
                idx = np.where(classes == c)[0]
                keep += [int(idx[k]) for k in nms(boxes[idx], scores[idx], iou)]
            keep.sort(key=lambda i: -float(scores[i]))

        for i in keep[:max_det]:
            x1, y1, x2, y2 = boxes[i]
            # обратно в координаты исходного изображения
            x1 = float(np.clip((x1 - px) / r, 0, w))
            x2 = float(np.clip((x2 - px) / r, 0, w))
            y1 = float(np.clip((y1 - py) / r, 0, h))
            y2 = float(np.clip((y2 - py) / r, 0, h))
            if x2 - x1 < 2 or y2 - y1 < 2:
                continue
            c = int(classes[i])
            name = self.names[c] if c < len(self.names) else str(c)
            dets.append(Detection(cls=c, name=name, confidence=float(scores[i]), box=(x1, y1, x2, y2)))
        return dets
