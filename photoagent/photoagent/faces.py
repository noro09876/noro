"""Поиск лиц (YuNet) и сравнение личности (SFace).

Используется для защиты лица при редактировании и для контроля качества:
лицо после обработки сравнивается с оригиналом.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .imageio import to_uint8
from .models import ModelCache, ModelMissing


@dataclass
class Face:
    box: tuple[float, float, float, float]  # x, y, w, h в пикселях полного кадра
    landmarks: np.ndarray  # 5x2: правый глаз, левый глаз, нос, правый и левый угол рта
    score: float
    raw: np.ndarray  # строка YuNet (15 чисел) в координатах полного кадра

    @property
    def center(self) -> tuple[float, float]:
        x, y, w, h = self.box
        return x + w / 2, y + h / 2


def detect(cache: ModelCache, rgb: np.ndarray, max_side: int = 1280) -> list[Face]:
    det = cache.opencv_face("detector")
    h, w = rgb.shape[:2]
    s = min(1.0, max_side / max(h, w))
    small = cv2.resize(rgb, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA) if s < 1 else rgb
    bgr = cv2.cvtColor(to_uint8(small), cv2.COLOR_RGB2BGR)
    det.setInputSize((bgr.shape[1], bgr.shape[0]))
    _, res = det.detect(bgr)
    faces: list[Face] = []
    if res is None:
        return faces
    for row in res:
        full = row.copy()
        full[:14] = row[:14] / s
        faces.append(Face(
            box=tuple(float(v) for v in full[:4]),
            landmarks=full[4:14].reshape(5, 2).astype(np.float32),
            score=float(row[14]),
            raw=full.astype(np.float32),
        ))
    faces.sort(key=lambda f: f.box[2] * f.box[3], reverse=True)
    return faces


def embedding(cache: ModelCache, rgb: np.ndarray, face: Face) -> np.ndarray:
    rec = cache.opencv_face("recognizer")
    bgr = cv2.cvtColor(to_uint8(rgb), cv2.COLOR_RGB2BGR)
    aligned = rec.alignCrop(bgr, face.raw)
    return rec.feature(aligned).astype(np.float32)


def similarity(cache: ModelCache, a: np.ndarray, b: np.ndarray) -> float:
    rec = cache.opencv_face("recognizer")
    return float(rec.match(a, b, cv2.FaceRecognizerSF_FR_COSINE))


def face_mask(shape: tuple[int, int], faces: list[Face], scale: float = 1.25, with_hair: bool = False) -> np.ndarray:
    """Эллиптическая маска лиц (для защиты от изменений). Значения 0..1."""
    h, w = shape
    m = np.zeros((h, w), np.float32)
    for f in faces:
        x, y, bw, bh = f.box
        cx, cy = x + bw / 2, y + bh / 2
        ax, ay = bw * scale / 2, bh * scale / 2 * 1.1
        cv2.ellipse(m, (int(cx), int(cy)), (int(ax), int(ay)), 0, 0, 360, 1.0, -1)
        if with_hair:
            # Причёска: область над и по бокам лица
            cv2.ellipse(m, (int(cx), int(cy - bh * 0.25)), (int(bw * 0.95), int(bh * 0.95)), 0, 0, 360, 1.0, -1)
    return m


def match_faces(a: list[Face], b: list[Face]) -> list[tuple[int, int]]:
    """Сопоставляет лица двух кадров по близости центров."""
    pairs = []
    used: set[int] = set()
    for i, fa in enumerate(a):
        best, bd = -1, 1e18
        for j, fb in enumerate(b):
            if j in used:
                continue
            d = (fa.center[0] - fb.center[0]) ** 2 + (fa.center[1] - fb.center[1]) ** 2
            if d < bd:
                best, bd = j, d
        if best >= 0 and bd ** 0.5 < max(fa.box[2], fa.box[3]):
            pairs.append((i, best))
            used.add(best)
    return pairs


def safe_detect(cache: ModelCache, rgb: np.ndarray) -> list[Face] | None:
    """Как detect, но возвращает None, если модели нет (проверка лица тогда пропускается)."""
    try:
        return detect(cache, rgb)
    except ModelMissing:
        return None
