import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from photoagent.config import load_settings  # noqa: E402


def synthetic_subject(h: int = 600, w: int = 450, seed: int = 0):
    """Синтетическая «фигура» с тонкими «волосами» и точной альфой: (F, alpha)."""
    rng = np.random.default_rng(seed)
    hi = 4  # рисуем в 4× разрешении, затем уменьшаем — получаются честные полупрозрачные края
    H, W = h * hi, w * hi
    a = np.zeros((H, W), np.float32)
    cv2.ellipse(a, (W // 2, int(H * 0.75)), (int(W * 0.33), int(H * 0.32)), 0, 0, 360, 1.0, -1)  # тело
    cv2.circle(a, (W // 2, int(H * 0.32)), int(W * 0.17), 1.0, -1)  # голова
    for _ in range(140):  # волосы
        x0 = W // 2 + int(rng.normal(0, W * 0.1))
        y0 = int(H * 0.22) + int(rng.normal(0, H * 0.02))
        ang = rng.uniform(-np.pi, 0)
        ln = rng.uniform(0.05, 0.14) * H
        x1, y1 = int(x0 + np.cos(ang) * ln), int(y0 + np.sin(ang) * ln)
        cv2.line(a, (x0, y0), (x1, y1), 1.0, thickness=hi // 2 + 1)
    alpha = cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA)
    F = np.zeros((h, w, 3), np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    F[..., 0] = 0.55 + 0.2 * np.sin(xx / 23)  # «одежда» с узором
    F[..., 1] = 0.30 + 0.1 * np.cos(yy / 31)
    F[..., 2] = 0.25 + 0.15 * np.sin((xx + yy) / 40)
    head = (yy < h * 0.45)
    F[head] = np.array([0.80, 0.62, 0.52], np.float32)  # «кожа»
    F[yy < h * 0.25] = np.array([0.25, 0.17, 0.10], np.float32)  # «волосы»
    return F, alpha


def green_screen(F, alpha, spill: float = 0.06, noise: float = 0.01, seed: int = 0):
    h, w = alpha.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    plate = np.stack([0.12 + 0.05 * xx / w, 0.62 - 0.12 * yy / h, 0.20 + 0.03 * xx / w], -1).astype(np.float32)
    Fs = F.copy()
    edge = cv2.GaussianBlur(1 - alpha, (0, 0), 6)
    Fs[..., 1] = np.clip(Fs[..., 1] + spill * edge, 0, 1)
    img = Fs * alpha[..., None] + plate * (1 - alpha[..., None])
    img += np.random.default_rng(seed).normal(0, noise, img.shape).astype(np.float32)
    return np.clip(img, 0, 1).astype(np.float32)


@pytest.fixture
def settings(tmp_path):
    return load_settings(tmp_path / "data")


@pytest.fixture
def real_models_dir():
    """Папка с уже скачанными моделями, если есть (для необязательных тестов)."""
    import os
    p = os.environ.get("PHOTOAGENT_TEST_MODELS")
    return Path(p) if p else None
