"""Замена фона и композитинг: человек переносится на фон/интерьер.

Чтобы вставка выглядела естественно:
* цвет и яркость объекта частично подстраиваются под новый фон;
* по краю добавляется «световое обтекание» (light wrap) от фона;
* выравнивается зерно/шум между объектом и фоном;
* при необходимости добавляется мягкая контактная тень.
Положение человека в кадре и размер кадра по умолчанию не меняются.
"""
from __future__ import annotations

import cv2
import numpy as np

from .. import imageio, imgutil
from .base import FrameContext, Operation, OperationError, register

NAMED_COLORS = {
    "white": (1.0, 1.0, 1.0), "black": (0.0, 0.0, 0.0), "gray": (0.5, 0.5, 0.5),
    "light_gray": (0.88, 0.88, 0.88), "blue": (0.16, 0.36, 0.75), "beige": (0.93, 0.88, 0.78),
}


def cover(bg: np.ndarray, size: tuple[int, int], anchor_y: float = 0.5) -> np.ndarray:
    """Масштабирует фон так, чтобы он полностью закрыл кадр (с обрезкой лишнего)."""
    w, h = size
    bh, bw = bg.shape[:2]
    s = max(w / bw, h / bh)
    nw, nh = max(w, round(bw * s)), max(h, round(bh * s))
    interp = cv2.INTER_AREA if s < 1 else cv2.INTER_LANCZOS4
    r = cv2.resize(bg, (nw, nh), interpolation=interp)
    x0 = (nw - w) // 2
    y0 = int((nh - h) * anchor_y)
    return np.clip(r[y0:y0 + h, x0:x0 + w], 0, 1)


def neutral_cast(lab: np.ndarray, weight: np.ndarray, max_chroma: float = 14.0) -> tuple[np.ndarray, int]:
    """Средний оттенок почти нейтральных (серых/белых) пикселей — так виден цвет освещения.

    Цвет одежды или стены не влияет на оценку, в отличие от среднего по всем пикселям.
    """
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    sel = (weight > 0.5) & (chroma < max_chroma) & (lab[..., 0] > 15) & (lab[..., 0] < 97)
    n = int(sel.sum())
    if n < 300:
        return np.zeros(2, np.float32), n
    return lab[sel][:, 1:].mean(0).astype(np.float32), n


def ring_mask(alpha: np.ndarray, frac: float = 0.15) -> np.ndarray:
    h, w = alpha.shape
    k = max(15, int(frac * max(h, w))) | 1
    around = cv2.dilate((alpha > 0.05).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    ring = (around > 0) & (alpha < 0.05)
    return ring if ring.sum() > 1000 else alpha < 0.05


def harmonize(fg: np.ndarray, alpha: np.ndarray, bg: np.ndarray, strength: float) -> tuple[np.ndarray, dict]:
    """Подстраивает освещение человека под новый фон: оттенок света и яркость средних тонов."""
    solid = (alpha > 0.95).astype(np.float32)
    ring = ring_mask(alpha).astype(np.float32)
    lab_f = imgutil.to_lab(fg)
    lab_b = imgutil.to_lab(bg)
    cast_f, nf = neutral_cast(lab_f, solid)
    cast_b, nb = neutral_cast(lab_b, ring)
    if nb < 300:  # на фоне нет нейтральных участков — берём общий оттенок фона, но слабее
        cast_b = np.array([lab_b[ring > 0.5][:, 1].mean(), lab_b[ring > 0.5][:, 2].mean()], np.float32) * 0.35
    d_ab = np.clip((cast_b - cast_f) * 0.8 * strength, -10, 10)
    Lf = float(np.median(lab_f[..., 0][solid > 0.5])) if solid.sum() else 50.0
    Lb = float(np.median(lab_b[..., 0][ring > 0.5]))
    dL = float(np.clip((Lb - Lf) * 0.3 * strength, -8, 8))
    out = lab_f.copy()
    # Свет влияет на средние тона сильнее, чем на глубокие тени и блики
    mid = np.clip(1.0 - np.abs(lab_f[..., 0] - 55) / 55, 0.3, 1.0)
    out[..., 0] += dL * mid
    out[..., 1] += d_ab[0]
    out[..., 2] += d_ab[1]
    return imgutil.from_lab(out), {"dL": dL, "da": float(d_ab[0]), "db": float(d_ab[1])}


def light_wrap(fg: np.ndarray, alpha: np.ndarray, bg: np.ndarray, amount: float) -> np.ndarray:
    h, w = alpha.shape
    r = max(3.0, 0.008 * max(h, w))
    bg_blur = cv2.GaussianBlur(bg, (0, 0), r)
    inv = cv2.GaussianBlur(1.0 - alpha, (0, 0), r)
    wrap = (inv * alpha)[..., None] * amount
    # Экранное смешивание: края подсвечиваются окружением, не темнеют
    return np.clip(fg + (1 - fg) * bg_blur * wrap, 0, 1)


def match_grain(fg: np.ndarray, bg: np.ndarray, alpha: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Добавляет шум более чистой части, чтобы зерно совпадало."""
    solid = alpha > 0.95
    empty = alpha < 0.05
    if solid.sum() < 1000 or empty.sum() < 1000:
        return fg, bg
    nf = imgutil.estimate_noise(np.where(solid, imgutil.luma(fg), np.median(imgutil.luma(fg)[solid])))
    nb = imgutil.estimate_noise(np.where(empty, imgutil.luma(bg), np.median(imgutil.luma(bg)[empty])))
    rng = np.random.default_rng(1)
    if nb > nf * 1.4 and nb - nf > 0.002:
        add = np.sqrt(max(nb ** 2 - nf ** 2, 0))
        fg = np.clip(fg + rng.normal(0, add, fg.shape[:2]).astype(np.float32)[..., None], 0, 1)
    elif nf > nb * 1.4 and nf - nb > 0.002:
        add = np.sqrt(max(nf ** 2 - nb ** 2, 0))
        bg = np.clip(bg + rng.normal(0, add, bg.shape[:2]).astype(np.float32)[..., None], 0, 1)
    return fg, bg


def contact_shadow(alpha: np.ndarray, strength: float) -> np.ndarray:
    """Мягкая тень у нижнего края фигуры (там, где человек стоит/сидит)."""
    h, w = alpha.shape
    m = (alpha > 0.5).astype(np.float32)
    rows = np.where(m.any(1))[0]
    if rows.size == 0:
        return np.zeros_like(alpha)
    bottom = rows.max()
    band = int(0.06 * h)
    foot = np.zeros_like(m)
    foot[max(0, bottom - band):bottom + 1] = m[max(0, bottom - band):bottom + 1]
    # Тень сплющена по вертикали и размыта
    sh = cv2.GaussianBlur(foot, (0, 0), max(2.0, 0.012 * w))
    sh = np.roll(sh, int(band * 0.25), axis=0)
    return np.clip(sh * strength, 0, 0.8)


@register
class ReplaceBackground(Operation):
    id = "replace_background"
    title = "Замена фона"
    fix_keys = ("harmonize_boost",)
    needs_refs = {"background": "фоновое изображение или фото интерьера"}

    def run(self, ctx: FrameContext, params: dict) -> None:
        alpha = ctx.photo.alpha
        if alpha is None:
            raise OperationError("Нет маски человека: замене фона должно предшествовать удаление фона.")
        h, w = alpha.shape
        color = params.get("color")
        if color:
            rgb = NAMED_COLORS.get(color) if isinstance(color, str) else tuple(color)
            if rgb is None:
                raise OperationError(f"Неизвестный цвет фона: {color}")
            bg = np.ones((h, w, 3), np.float32) * np.array(rgb, np.float32)
            bg_name = f"цвет {color}"
        else:
            ref = ctx.ref("background")
            if ref is None:
                raise OperationError("Для замены фона загрузите фоновое изображение (раздел «Референсы» → «Фон»).")
            bg = imageio.load(ref).rgb
            bg = cover(bg, (w, h), float(params.get("anchor_y", 0.5)))
            bg_name = ref.name
        blur = float(params.get("bg_blur", 0.0))
        if blur > 0:
            bg = cv2.GaussianBlur(bg, (0, 0), blur * max(h, w) / 1000)
        fg = ctx.photo.rgb
        strength = float(params.get("harmonize", 0.5)) * float(ctx.fixes.get("harmonize_boost", 1.0))
        strength = float(np.clip(strength, 0, 1))
        info = {}
        if strength > 0 and not color:
            fg, info = harmonize(fg, alpha, bg, strength)
        if params.get("light_wrap", 0.25) and not color:
            fg = light_wrap(fg, alpha, bg, float(params.get("light_wrap", 0.25)))
        if not color:
            fg, bg = match_grain(fg, bg, alpha)
        if params.get("shadow", 0.0):
            sh = contact_shadow(alpha, float(params["shadow"]))
            bg = bg * (1 - sh[..., None])
        a = alpha[..., None]
        out = fg * a + bg * (1 - a)
        ctx.photo.rgb = np.clip(out, 0, 1).astype(np.float32)
        ctx.photo.alpha = None
        ctx.masks["subject"] = alpha
        ctx.info["composited"] = True
        ctx.info["background_layer"] = bg
        ctx.note(self.id, f"Новый фон: {bg_name}", **{k: round(v, 2) for k, v in info.items()})
