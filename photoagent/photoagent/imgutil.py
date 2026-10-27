"""Общие численные функции для операций над изображениями."""
from __future__ import annotations

import cv2
import numpy as np


def srgb_to_linear(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)


def linear_to_srgb(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)


def luma(rgb: np.ndarray) -> np.ndarray:
    return (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]).astype(np.float32)


def to_lab(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(np.clip(rgb, 0, 1).astype(np.float32), cv2.COLOR_RGB2Lab)


def from_lab(lab: np.ndarray) -> np.ndarray:
    return np.clip(cv2.cvtColor(lab.astype(np.float32), cv2.COLOR_Lab2RGB), 0, 1)


def box(x: np.ndarray, r: int) -> np.ndarray:
    k = 2 * r + 1
    return cv2.boxFilter(x, -1, (k, k), borderType=cv2.BORDER_REFLECT)


def guided_filter(guide: np.ndarray, src: np.ndarray, r: int, eps: float) -> np.ndarray:
    """Цветной guided filter (He et al.). Переносит границы маски на мелкие детали фото."""
    guide = guide.astype(np.float32)
    src = src.astype(np.float32)
    if guide.ndim == 2:
        mI = box(guide, r)
        mp = box(src, r)
        cov = box(guide * src, r) - mI * mp
        var = box(guide * guide, r) - mI * mI
        a = cov / (var + eps)
        b = mp - a * mI
        return box(a, r) * guide + box(b, r)
    mI = [box(guide[..., i], r) for i in range(3)]
    mp = box(src, r)
    cov = [box(guide[..., i] * src, r) - mI[i] * mp for i in range(3)]
    v = {}
    for i in range(3):
        for j in range(i, 3):
            v[i, j] = box(guide[..., i] * guide[..., j], r) - mI[i] * mI[j] + (eps if i == j else 0.0)
    # Обращение симметричной 3x3 матрицы для каждого пикселя
    a11, a12, a13, a22, a23, a33 = v[0, 0], v[0, 1], v[0, 2], v[1, 1], v[1, 2], v[2, 2]
    i11 = a22 * a33 - a23 * a23
    i12 = a13 * a23 - a12 * a33
    i13 = a12 * a23 - a13 * a22
    i22 = a11 * a33 - a13 * a13
    i23 = a12 * a13 - a11 * a23
    i33 = a11 * a22 - a12 * a12
    det = a11 * i11 + a12 * i12 + a13 * i13
    det = np.where(np.abs(det) < 1e-12, 1e-12, det)
    ax = (i11 * cov[0] + i12 * cov[1] + i13 * cov[2]) / det
    ay = (i12 * cov[0] + i22 * cov[1] + i23 * cov[2]) / det
    az = (i13 * cov[0] + i23 * cov[1] + i33 * cov[2]) / det
    b = mp - ax * mI[0] - ay * mI[1] - az * mI[2]
    return (box(ax, r) * guide[..., 0] + box(ay, r) * guide[..., 1] + box(az, r) * guide[..., 2] + box(b, r))


def resize_to(x: np.ndarray, size: tuple[int, int], interp: int | None = None) -> np.ndarray:
    """size = (w, h)."""
    h, w = x.shape[:2]
    if (w, h) == tuple(size):
        return x
    if interp is None:
        interp = cv2.INTER_AREA if size[0] < w else cv2.INTER_CUBIC
    return cv2.resize(x, size, interpolation=interp)


def limit_side(x: np.ndarray, max_side: int) -> tuple[np.ndarray, float]:
    h, w = x.shape[:2]
    s = min(1.0, max_side / float(max(h, w)))
    if s >= 1.0:
        return x, 1.0
    return cv2.resize(x, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA), s


def feather(mask: np.ndarray, radius: float) -> np.ndarray:
    if radius <= 0:
        return mask
    k = int(radius * 3) | 1
    return cv2.GaussianBlur(mask.astype(np.float32), (k, k), radius)


def remove_small_islands(alpha: np.ndarray, min_frac: float = 0.002, thr: float = 0.5) -> tuple[np.ndarray, int]:
    """Убирает мелкие отдельные пятна маски (мусор на фоне). Возвращает маску и число удалённых."""
    binm = (alpha > thr).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(binm, connectivity=8)
    if n <= 2:
        return alpha, 0
    areas = stats[1:, cv2.CC_STAT_AREA]
    biggest = areas.max()
    min_area = max(min_frac * alpha.size, 0.02 * biggest)
    keep = np.zeros(n, bool)
    keep[1:] = areas >= min_area
    removed = int((~keep[1:]).sum())
    if removed == 0:
        return alpha, 0
    keep_mask = keep[lab].astype(np.uint8)
    # Полупрозрачные пиксели рядом с сохранёнными областями (волосы) не трогаем
    near = cv2.dilate(keep_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))) > 0
    drop = (binm > 0) & (keep_mask == 0)
    drop_soft = (~near) & (alpha > 0.02) & (binm == 0)
    out = alpha.copy()
    out[drop | drop_soft] = 0.0
    return out, removed


def estimate_noise(gray: np.ndarray) -> float:
    """Оценка шума Immerkær (СКО в единицах [0, 1])."""
    g = gray.astype(np.float32)
    if max(g.shape) > 2000:
        s = 2000 / max(g.shape)
        g = cv2.resize(g, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        # уменьшение снижает шум; поправка примерно на корень масштаба
        corr = 1.0 / max(s, 1e-3) ** 0.5
    else:
        corr = 1.0
    k = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], np.float32)
    conv = cv2.filter2D(g, -1, k)
    h, w = g.shape
    sigma = np.sum(np.abs(conv[1:-1, 1:-1])) * np.sqrt(0.5 * np.pi) / (6.0 * (w - 2) * (h - 2))
    return float(sigma * corr)


def foreground_blur_fusion(image: np.ndarray, alpha: np.ndarray, radius: int = 45, iterations: int = 2) -> np.ndarray:
    """Оценка «чистого» цвета переднего плана (Forte & Pitié, blur-fusion).

    На полупрозрачных краях (волосы) убирает примесь старого фона.
    """
    a2 = alpha.astype(np.float32)
    a = a2[..., None]
    image = image.astype(np.float32)
    F = image.copy()
    B = image.copy()
    for r in [radius] + [max(3, radius // 8)] * (iterations - 1):
        k = (2 * r + 1, 2 * r + 1)
        ba = cv2.blur(a2, k)[..., None]
        bF = cv2.blur(F * a, k) / (ba + 1e-5)
        b1a = cv2.blur(1.0 - a2, k)[..., None]
        bB = cv2.blur(B * (1.0 - a), k) / (b1a + 1e-5)
        F = np.clip(bF + a * (image - a * bF - (1.0 - a) * bB), 0, 1)
        B = bB
    return F.astype(np.float32)


def skin_probability(rgb: np.ndarray) -> np.ndarray:
    """Грубая вероятность кожи по YCrCb. Используется только вместе с маской лица/человека."""
    ycc = cv2.cvtColor(np.clip(rgb, 0, 1).astype(np.float32), cv2.COLOR_RGB2YCrCb)
    cr = ycc[..., 1] * 255.0
    cb = ycc[..., 2] * 255.0
    y = ycc[..., 0]
    # Центр и разброс типичных оттенков кожи для разных фототипов
    d = ((cr - 150.0) / 16.0) ** 2 + ((cb - 110.0) / 15.0) ** 2
    p = np.exp(-0.5 * d)
    p *= np.clip((y - 0.08) / 0.1, 0, 1)
    return p.astype(np.float32)
