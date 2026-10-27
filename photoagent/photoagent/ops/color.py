"""Цветокоррекция: баланс белого, экспозиция, контраст, кожа, насыщенность.

Все коррекции ограничены по силе: цель — естественная фотография, а не
«авто-фильтр». Если кадр уже в порядке, операция почти ничего не меняет.
Прозрачные (удалённые) области в расчётах не участвуют.
"""
from __future__ import annotations

import numpy as np

from .. import faces as facemod
from .. import imgutil
from ..models import ModelMissing
from .base import FrameContext, Operation, register


def _weights(ctx: FrameContext) -> np.ndarray:
    a = ctx.photo.alpha
    h, w = ctx.photo.rgb.shape[:2]
    return (a > 0.9).astype(np.float32) if a is not None else np.ones((h, w), np.float32)


def _sample(rgb: np.ndarray, weight: np.ndarray, n: int = 400_000) -> np.ndarray:
    idx = np.flatnonzero(weight.reshape(-1) > 0.5)
    if idx.size == 0:
        idx = np.arange(weight.size)
    if idx.size > n:
        idx = np.random.default_rng(0).choice(idx, n, replace=False)
    return rgb.reshape(-1, 3)[idx]


def white_balance_gains(rgb: np.ndarray, weight: np.ndarray) -> np.ndarray:
    """Устойчивый «серый мир» по нейтральным полутонам в линейном цвете."""
    px = imgutil.srgb_to_linear(_sample(rgb, weight))
    lum = px @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    mx, mn = px.max(1), px.min(1)
    sat = (mx - mn) / (mx + 1e-6)
    lo, hi = np.percentile(lum, [5, 97])
    sel = (lum > lo) & (lum < hi) & (mx < 0.98)
    # предпочитаем почти нейтральные пиксели — они лучше всего показывают оттенок света
    neutral = sel & (sat < np.percentile(sat[sel], 35)) if sel.any() else sel
    use = px[neutral] if neutral.sum() > 500 else px[sel] if sel.sum() > 500 else px
    mean = use.mean(0) + 1e-6
    g = mean.mean() / mean
    return (g / (g @ np.array([0.2126, 0.7152, 0.0722], np.float32))).astype(np.float32)


@register
class WhiteBalance(Operation):
    id = "white_balance"
    title = "Баланс белого"

    def run(self, ctx: FrameContext, params: dict) -> None:
        strength = float(params.get("strength", 0.8))
        temp = float(params.get("temperature", 0.0))  # -1 холоднее … +1 теплее
        rgb = ctx.photo.rgb
        if params.get("auto", True):
            gains = white_balance_gains(rgb, _weights(ctx))
            gains = np.clip(gains, 0.75, 1.33)
            gains = 1.0 + (gains - 1.0) * strength
        else:
            gains = np.ones(3, np.float32)
        if temp:
            gains = gains * np.array([1 + 0.08 * temp, 1.0, 1 - 0.08 * temp], np.float32)
        lin = imgutil.srgb_to_linear(rgb) * gains
        ctx.photo.rgb = imgutil.linear_to_srgb(lin)
        ctx.note(self.id, "Баланс белого", gains=[round(float(g), 3) for g in gains])


def _soft_clip(x: np.ndarray, knee: float = 0.8) -> np.ndarray:
    """Мягкое «плечо» в светах вместо жёсткого выбивания в белое."""
    over = x > knee
    y = x.copy()
    t = (x[over] - knee) / (1 - knee)
    y[over] = knee + (1 - knee) * (1 - np.exp(-t))
    return y


@register
class ExposureContrast(Operation):
    id = "exposure_contrast"
    title = "Экспозиция и контраст"
    fix_keys = ("exposure_scale",)

    def run(self, ctx: FrameContext, params: dict) -> None:
        rgb = ctx.photo.rgb
        weight = _weights(ctx)
        L = imgutil.luma(rgb)
        sample = L.reshape(-1)[weight.reshape(-1) > 0.5]
        if sample.size == 0:
            sample = L.reshape(-1)
        ev = float(params.get("exposure", 0.0))
        if params.get("auto", True):
            med = float(np.median(sample))
            target = float(params.get("target", 0.46))
            auto_ev = np.log2(max(target, 1e-3) / max(med, 1e-3)) * 0.6  # линейный гамма-приближённый шаг
            auto_ev = float(np.clip(auto_ev, -0.7, 0.9))
            if abs(auto_ev) < 0.08:
                auto_ev = 0.0
            ev += auto_ev
        ev *= float(ctx.fixes.get("exposure_scale", 1.0))
        lin = imgutil.srgb_to_linear(rgb) * (2.0 ** ev)
        out = imgutil.linear_to_srgb(_soft_clip(lin, 0.85))
        contrast = float(params.get("contrast", 0.0))  # -1..1
        if params.get("auto", True):
            lo, hi = np.percentile(imgutil.luma(out).reshape(-1)[weight.reshape(-1) > 0.5] if sample.size else L, [0.3, 99.7])
            # Растягиваем, только если гистограмма заметно «сжата», и не больше чем на 15%
            span = hi - lo
            if span < 0.85:
                gain = min(1.15, 0.92 / max(span, 1e-3))
                pivot = (lo + hi) / 2
                out = np.clip((out - pivot) * gain + pivot, 0, 1)
        if contrast:
            # S-кривая вокруг средних тонов
            k = 1.0 + 0.6 * contrast
            out = np.clip(0.5 + (out - 0.5) * k - 0.12 * contrast * (out - 0.5) ** 3 * 4, 0, 1)
        ctx.photo.rgb = out.astype(np.float32)
        ctx.note(self.id, "Экспозиция и контраст", ev=round(ev, 2), contrast=contrast)


@register
class SkinTone(Operation):
    id = "skin_tone"
    title = "Естественный цвет кожи"

    def run(self, ctx: FrameContext, params: dict) -> None:
        strength = float(params.get("strength", 0.5))
        rgb = ctx.photo.rgb
        h, w = rgb.shape[:2]
        try:
            found = facemod.detect(ctx.cache, rgb)
        except ModelMissing:
            ctx.warn("Модель поиска лиц не скачана: коррекция кожи пропущена.")
            return
        if not found:
            ctx.note(self.id, "Лица не найдены — коррекция кожи пропущена")
            return
        region = facemod.face_mask((h, w), found, scale=1.0)
        skin = imgutil.skin_probability(rgb) * region
        if skin.sum() < 200:
            return
        lab = imgutil.to_lab(rgb)
        wsum = skin.sum()
        a_mean = float((lab[..., 1] * skin).sum() / wsum)
        b_mean = float((lab[..., 2] * skin).sum() / wsum)
        # Естественная кожа лежит на «линии кожи» с углом оттенка ~ 40–70° в плоскости a*b*.
        hue = np.degrees(np.arctan2(b_mean, a_mean))
        chroma = np.hypot(a_mean, b_mean)
        target_hue = float(np.clip(hue, 42.0, 66.0))
        target_chroma = float(np.clip(chroma, 14.0, 34.0))
        ta = target_chroma * np.cos(np.radians(target_hue))
        tb = target_chroma * np.sin(np.radians(target_hue))
        da, db = (ta - a_mean) * strength, (tb - b_mean) * strength
        if abs(da) + abs(db) < 0.8:
            ctx.note(self.id, "Цвет кожи в норме, коррекция не нужна")
            return
        # Сдвиг применяется ко всем похожим на кожу пикселям кадра (руки, шея), мягко
        skin_all = imgutil.skin_probability(rgb)
        if ctx.photo.alpha is not None:
            skin_all *= ctx.photo.alpha
        skin_all = imgutil.feather(skin_all, 2.0)
        lab[..., 1] += da * skin_all
        lab[..., 2] += db * skin_all
        ctx.photo.rgb = imgutil.from_lab(lab)
        ctx.note(self.id, "Коррекция оттенка кожи", da=round(da, 2), db=round(db, 2))


@register
class Saturation(Operation):
    id = "saturation"
    title = "Насыщенность"

    def run(self, ctx: FrameContext, params: dict) -> None:
        amount = float(params.get("amount", 0.0))  # -1..1
        if not amount:
            return
        lab = imgutil.to_lab(ctx.photo.rgb)
        chroma = np.hypot(lab[..., 1], lab[..., 2])
        # «Вибрация»: слабонасыщенные цвета усиливаются сильнее, кожа — слабее
        k = 1.0 + amount * 0.35 * (1.0 - np.clip(chroma / 60.0, 0, 1))
        skin = imgutil.skin_probability(ctx.photo.rgb)
        k = 1.0 + (k - 1.0) * (1.0 - 0.6 * skin)
        lab[..., 1] *= k
        lab[..., 2] *= k
        ctx.photo.rgb = imgutil.from_lab(lab)
        ctx.note(self.id, "Насыщенность", amount=amount)
