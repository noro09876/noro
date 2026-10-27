"""Удаление фона: хромакей, нейросетевое выделение (BiRefNet) и их сочетание.

Хромакей даёт самые тонкие волосы на ровном зелёном/синем фоне; нейросеть
страхует от «дыр» (зелёная одежда, блики) и мусора за краем фона.
После вычисления маски из полупрозрачных краёв вычитается цвет старого фона
(расмешивание) и подавляется зелёный ореол (despill).
"""
from __future__ import annotations

import cv2
import numpy as np

from .. import imgutil
from ..models import ModelMissing, is_installed, sigmoid
from .base import FrameContext, Operation, OperationError, register

MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


# ---------------------------------------------------------------- хромакей

def detect_screen(rgb: np.ndarray) -> tuple[str | None, float]:
    """Определяет, снят ли кадр на зелёном/синем фоне. Возвращает (цвет, доля края)."""
    h, w = rgb.shape[:2]
    small, _ = imgutil.limit_side(rgb, 512)
    sh, sw = small.shape[:2]
    bw = max(2, int(min(sh, sw) * 0.04))
    border = np.concatenate([
        small[:bw].reshape(-1, 3), small[-bw:].reshape(-1, 3),
        small[:, :bw].reshape(-1, 3), small[:, -bw:].reshape(-1, 3)])
    r, g, b = border[:, 0], border[:, 1], border[:, 2]
    green = float(np.mean((g - np.maximum(r, b)) > 0.06))
    blue = float(np.mean((b - np.maximum(r, g)) > 0.06))
    if green >= 0.45 and green >= blue:
        return "green", green
    if blue >= 0.45:
        return "blue", blue
    return None, max(green, blue)


def _excess(rgb: np.ndarray, screen: str) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if screen == "green":
        return g - np.maximum(r, b)
    return b - np.maximum(r, g)


def _fill_plate(rgb: np.ndarray, mask: np.ndarray, levels: int = 9) -> np.ndarray:
    """Достраивает цвет фона под объектом (нормализованная свёртка по пирамиде)."""
    h, w = mask.shape
    s = min(1.0, 384.0 / max(h, w))
    small = cv2.resize(rgb, (max(8, int(w * s)), max(8, int(h * s))), interpolation=cv2.INTER_AREA)
    m = cv2.resize(mask.astype(np.float32), (small.shape[1], small.shape[0]), interpolation=cv2.INTER_AREA)
    num = small * m[..., None]
    den = m.copy()
    plate = np.zeros_like(small)
    filled = np.zeros(m.shape, bool)
    good = den > 0.5
    plate[good] = num[good] / den[good][:, None]
    filled |= good
    for i in range(levels):
        k = 2 ** (i + 2) + 1
        bn = cv2.blur(num, (k, k))
        bd = cv2.blur(den, (k, k))
        ok = (~filled) & (bd > 0.02)
        plate[ok] = bn[ok] / bd[ok][:, None]
        filled |= ok
        if filled.all():
            break
    if not filled.all():
        mean = (num.reshape(-1, 3).sum(0) / max(den.sum(), 1e-6)).astype(np.float32)
        plate[~filled] = mean
    plate = cv2.GaussianBlur(plate, (0, 0), 2.0)
    return cv2.resize(plate, (w, h), interpolation=cv2.INTER_LINEAR)


def chroma_alpha(rgb: np.ndarray, screen: str, tolerance: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Маска по цветоразностному ключу с учётом неравномерного освещения фона.

    Возвращает (alpha, plate), где plate — восстановленный цвет фона.
    """
    ex = _excess(rgb, screen)
    small, _ = imgutil.limit_side(rgb, 512)
    sex = _excess(small, screen)
    ref = np.percentile(sex[sex > 0.05], 75) if np.any(sex > 0.05) else 0.2
    candidate = ex > max(0.04, 0.45 * ref)
    # Убираем одиночные пиксели, чтобы зелёные детали одежды не попали в образец фона
    candidate = cv2.morphologyEx(candidate.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0
    plate = _fill_plate(rgb, candidate)
    plate_ex = np.maximum(_excess(plate, screen), 0.05)
    raw = 1.0 - np.clip(ex / plate_ex, 0.0, 1.0)
    # Уровень «чёрного»: шум ключа на заведомом фоне
    bg_vals = raw[candidate]
    black = float(np.clip(np.percentile(bg_vals, 99.0) + 0.02, 0.03, 0.3)) if bg_vals.size else 0.08
    black = float(np.clip(black / max(tolerance, 0.3), 0.01, 0.4))
    white = 0.92
    alpha = np.clip((raw - black) / (white - black), 0.0, 1.0)
    return alpha.astype(np.float32), plate.astype(np.float32)


def unmix_and_despill(rgb: np.ndarray, alpha: np.ndarray, plate: np.ndarray | None, screen: str | None,
                      strength: float = 0.7) -> np.ndarray:
    """Чистый цвет переднего плана: вычитание фона на краях и подавление ореола."""
    a = alpha[..., None]
    if plate is not None:
        safe = np.maximum(a, 0.05)
        F = (rgb - (1.0 - a) * plate) / safe
        edge = (alpha > 0.01) & (alpha < 0.99)
        out = rgb.copy()
        out[edge] = np.clip(F[edge], 0, 1)
    else:
        out = imgutil.foreground_blur_fusion(rgb, alpha)
    if screen is None:
        return out
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    if screen == "green":
        main, o1, o2 = g, r, b
    else:
        main, o1, o2 = b, r, g
    limit = (1 - strength) * np.maximum(o1, o2) + strength * (o1 + o2) / 2
    excess = np.maximum(main - limit, 0)
    # Внутри объекта гасим только слабый «отсвет»; явно зелёные вещи (одежда) не трогаем
    h, w = alpha.shape
    band = max(3, int(0.006 * (h * h + w * w) ** 0.5))
    hard = (alpha > 0.98).astype(np.uint8)
    interior = cv2.erode(hard, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * band + 1, 2 * band + 1))) > 0
    strong_color = np.clip(1.0 - (excess - 0.06) / 0.14, 0.0, 1.0)
    weight = np.where(interior, strong_color, 1.0).astype(np.float32)
    removed = excess * weight
    lum_before = imgutil.luma(out)
    new_main = main - removed
    if screen == "green":
        out = np.stack([r, new_main, b], -1)
    else:
        out = np.stack([r, g, new_main], -1)
    # Компенсация яркости: удалённый зелёный возвращаем нейтральным серым
    lum_after = imgutil.luma(out)
    out = out + (lum_before - lum_after)[..., None] * 0.8
    return np.clip(out, 0, 1).astype(np.float32)


# ---------------------------------------------------------------- нейросеть

def pick_matting_model(ctx: FrameContext) -> str:
    for mid in ("birefnet_portrait", "birefnet_lite"):
        if is_installed(ctx.settings.models_dir, mid):
            return mid
    raise ModelMissing("birefnet_portrait")


def birefnet_alpha(ctx: FrameContext, rgb: np.ndarray, model_id: str | None = None) -> np.ndarray:
    model_id = model_id or pick_matting_model(ctx)
    sess = ctx.cache.onnx(model_id)
    inp = sess.get_inputs()[0]
    side = inp.shape[2] if isinstance(inp.shape[2], int) else 1024
    h, w = rgb.shape[:2]
    x = cv2.resize(rgb, (side, side), interpolation=cv2.INTER_AREA if max(h, w) > side else cv2.INTER_CUBIC)
    x = ((x - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
    try:
        out = sess.run(None, {inp.name: x})[0]
    except Exception as e:  # нехватка видеопамяти и т.п.
        raise OperationError(f"Нейросеть выделения не отработала: {e}", transient=True) from e
    pred = np.squeeze(out).astype(np.float32)
    if pred.min() < 0 or pred.max() > 1:
        pred = sigmoid(pred)
    # Возврат к размеру кадра с уточнением границ по самому фото
    work_side = min(max(h, w), 2560)
    work, s = imgutil.limit_side(rgb, work_side)
    wh, ww = work.shape[:2]
    up = cv2.resize(pred, (ww, wh), interpolation=cv2.INTER_CUBIC)
    r = max(2, int(max(wh, ww) / 512))
    refined = imgutil.guided_filter(work, up, r, 1e-4)
    # Внутри уверенных областей guided filter не должен «просвечивать»
    refined = np.where(up > 0.97, np.maximum(refined, up), refined)
    refined = np.where(up < 0.02, np.minimum(refined, up), refined)
    refined = np.clip(refined, 0, 1)
    if s < 1.0:
        refined = cv2.resize(refined, (w, h), interpolation=cv2.INTER_CUBIC)
    return np.clip(refined, 0, 1).astype(np.float32)


def combine_chroma_ai(chroma: np.ndarray, ai: np.ndarray) -> np.ndarray:
    """Хромакей задаёт тонкие края, нейросеть исправляет крупные ошибки."""
    h, w = chroma.shape
    k = max(3, int(0.01 * max(h, w))) | 1
    sure_fg = cv2.erode((ai > 0.9).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0
    kb = max(5, int(0.03 * max(h, w))) | 1
    sure_bg = cv2.erode((ai < 0.05).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kb, kb))) > 0
    out = chroma.copy()
    out[sure_bg] = 0.0
    out[sure_fg] = np.maximum(chroma[sure_fg], ai[sure_fg])
    return out


@register
class RemoveBackground(Operation):
    id = "remove_background"
    title = "Удаление фона"
    fix_keys = ("key_tolerance", "despill_boost", "alpha_erode")

    def run(self, ctx: FrameContext, params: dict) -> None:
        rgb = ctx.photo.rgb
        method = params.get("method", "auto")
        screen = params.get("screen", "auto")
        tolerance = float(params.get("tolerance", 1.0)) * float(ctx.fixes.get("key_tolerance", 1.0))
        despill = float(np.clip(params.get("despill", 0.7) * ctx.fixes.get("despill_boost", 1.0), 0, 1))

        detected, frac = detect_screen(rgb)
        if screen == "auto":
            screen = detected
        elif screen not in ("green", "blue"):
            screen = None
        elif detected != screen and any(is_installed(ctx.settings.models_dir, m) for m in ("birefnet_portrait", "birefnet_lite")):
            # В задании сказано «зелёный фон», но этот кадр снят не на хромакее (например, трава на улице)
            ctx.warn("На этом кадре нет однотонного цветного фона — использовано нейросетевое выделение.")
            screen = None
            method = "ai"
        if method == "auto":
            method = "chroma" if screen else "ai"
        if method == "chroma" and not screen:
            ctx.warn("Однотонный зелёный или синий фон не найден — использую нейросетевое выделение.")
            method = "ai"
        ctx.info["screen"] = screen
        ctx.info["bg_method"] = method

        plate = None
        if method == "chroma":
            alpha, plate = chroma_alpha(rgb, screen, tolerance)
            ctx.on_progress("Хромакей", 0.4)
            ctx.checkpoint()
            use_ai = params.get("ai_assist", True)
            if use_ai:
                try:
                    ai = birefnet_alpha(ctx, rgb)
                    ctx.masks["ai_subject"] = ai
                    alpha = combine_chroma_ai(alpha, ai)
                    ctx.note(self.id, "Маска хромакея уточнена нейросетью")
                except ModelMissing:
                    ctx.warn("Модель BiRefNet не скачана: маска построена только хромакеем. "
                             "Зелёные детали одежды могут стать прозрачными.")
            ctx.note(self.id, f"Хромакей ({'зелёный' if screen == 'green' else 'синий'} фон, край {frac:.0%})")
        else:
            try:
                alpha = birefnet_alpha(ctx, rgb)
            except ModelMissing as e:
                raise OperationError(str(e)) from e
            ctx.masks["ai_subject"] = alpha
            ctx.note(self.id, "Нейросетевое выделение объекта (BiRefNet)")

        alpha, removed = imgutil.remove_small_islands(alpha)
        if removed:
            ctx.note(self.id, f"Удалено мелких пятен мусора: {removed}")
        erode = int(ctx.fixes.get("alpha_erode", 0))
        if erode > 0:
            k = 2 * erode + 1
            alpha = np.minimum(alpha, cv2.erode(alpha, np.ones((k, k), np.uint8)) * 0.5 + alpha * 0.5)
        ctx.on_progress("Очистка краёв", 0.8)
        fg = unmix_and_despill(rgb, alpha, plate, screen, despill)
        ctx.photo.rgb = fg
        ctx.photo.alpha = alpha
        ctx.masks["subject"] = alpha
