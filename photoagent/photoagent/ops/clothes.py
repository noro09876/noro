"""Замена одежды с сохранением лица, причёски, рук и позы.

Модель редактирования (FLUX.2 klein через локальный ComfyUI) видит человека
целиком, но в итоговый кадр переносится только область одежды. Лицо,
причёска и открытая кожа (руки, шея) копируются из исходника пиксель в
пиксель, поэтому личность не может «уплыть» даже при неудачной генерации.
После вставки контроль качества сравнивает лицо с оригиналом и ищет
появившуюся «лишнюю» кожу (признак лишних рук/пальцев).
"""
from __future__ import annotations

import cv2
import numpy as np

from .. import faces as facemod
from .. import imageio, imgutil
from ..models import ModelMissing
from .background import birefnet_alpha
from .base import FrameContext, Operation, OperationError, register

PROMPT_TEMPLATE = (
    "Change only the clothing: dress the person in {garment}. Keep the same person with the exact same face, "
    "facial features, age, hairstyle, pose, hand position and body proportions. Keep the background unchanged. "
    "Photorealistic, natural fabric folds and texture, lighting and shadows consistent with the scene."
)


def build_masks(ctx: FrameContext, rgb: np.ndarray, preserve: dict) -> tuple[np.ndarray, np.ndarray, list]:
    """Возвращает (маска редактирования, защищённая маска, лица)."""
    h, w = rgb.shape[:2]
    person = ctx.masks.get("subject")
    if person is None or person.shape != (h, w):
        try:
            person = birefnet_alpha(ctx, rgb)
        except ModelMissing as e:
            raise OperationError(str(e)) from e
        ctx.masks["subject"] = person
    try:
        found = facemod.detect(ctx.cache, rgb)
    except ModelMissing as e:
        raise OperationError("Для замены одежды с сохранением лица нужны модели лиц: " + str(e)) from e
    more = bool(ctx.fixes.get("protect_face_more"))
    body = (person > 0.5).astype(np.uint8)
    prot = np.zeros((h, w), np.float32)
    if found:
        prot = np.maximum(prot, facemod.face_mask((h, w), found, scale=1.45 if more else 1.3,
                                                  with_hair=preserve.get("hair", True)))
    else:
        ctx.warn("Лицо не найдено: защищена только открытая кожа. Проверьте результат вручную.")
    # Открытая кожа (руки, шея, лицо) — тоже защищается
    skin = (imgutil.skin_probability(rgb) > 0.45).astype(np.uint8) & body
    skin = cv2.morphologyEx(skin, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    if preserve.get("hands", True):
        prot = np.maximum(prot, skin.astype(np.float32))
    k = max(3, int(0.006 * max(h, w))) | 1
    prot = cv2.dilate((prot > 0.5).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))).astype(np.float32)
    # Одежда может быть шире исходной (мантия): разрешаем выход за силуэт, но не выше подбородка
    grow = max(5, int(float(ctx.spec.get("ops", {}).get("change_clothes", {}).get("grow", 0.035)) * max(h, w))) | 1
    region = cv2.dilate(body, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow, grow)))
    if found:
        chin = int(max(f.box[1] + f.box[3] * 0.92 for f in found[:1]))
        region[:chin] = 0
    edit = (region > 0) & (prot < 0.5)
    edit = cv2.morphologyEx(edit.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)).astype(np.float32)
    return edit, prot, found


def crop_box(mask: np.ndarray, extra: np.ndarray, margin: float = 0.08) -> tuple[int, int, int, int]:
    ys, xs = np.where((mask > 0.5) | (extra > 0.5))
    h, w = mask.shape
    if ys.size == 0:
        return 0, 0, w, h
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    my, mx = int((y1 - y0) * margin), int((x1 - x0) * margin)
    return max(0, x0 - mx), max(0, y0 - my), min(w, x1 + mx), min(h, y1 + my)


def model_size(w: int, h: int, megapixels: float) -> tuple[int, int]:
    s = (megapixels * 1e6 / (w * h)) ** 0.5
    s = min(s, 1.0) if w * h > megapixels * 1e6 else s
    return max(256, int(round(w * s / 16)) * 16), max(256, int(round(h * s / 16)) * 16)


def match_colors(edited: np.ndarray, base: np.ndarray, ring: np.ndarray) -> np.ndarray:
    """Убирает общий цветовой сдвиг модели, сравнивая неизменяемую окрестность."""
    if ring.sum() < 500:
        return edited
    le, lb = imgutil.to_lab(edited), imgutil.to_lab(base)
    d = (lb[ring] - le[ring]).mean(0)
    d = np.clip(d, -12, 12)
    return imgutil.from_lab(le + d)


@register
class ChangeClothes(Operation):
    id = "change_clothes"
    title = "Замена одежды (ИИ)"
    fix_keys = ("protect_face_more", "seed_offset", "edit_strength_boost")
    needs_comfyui = True

    def run(self, ctx: FrameContext, params: dict) -> None:
        if ctx.comfy is None:
            raise OperationError("Замена одежды требует запущенный локальный ComfyUI с моделью FLUX.2 klein 4B.")
        rgb = ctx.photo.rgb
        if ctx.photo.alpha is not None:
            a = ctx.photo.alpha[..., None]
            rgb = rgb * a + 0.5 * (1 - a)
        h, w = rgb.shape[:2]
        preserve = params.get("preserve") or {}
        edit, prot, found = build_masks(ctx, rgb, preserve)
        if edit.sum() < 0.002 * h * w:
            raise OperationError("Не удалось найти область одежды на кадре")
        x0, y0, x1, y1 = crop_box(edit, ctx.masks["subject"])
        crop = rgb[y0:y1, x0:x1]
        mw, mh = model_size(x1 - x0, y1 - y0, float(params.get("megapixels", 1.0)))
        small = cv2.resize(crop, (mw, mh), interpolation=cv2.INTER_AREA)
        garment = params.get("prompt") or params.get("prompt_ru") or "different clothes"
        prompt = PROMPT_TEMPLATE.format(garment=garment)
        ref = ctx.ref("clothes")
        reference = None
        if ref is not None:
            r = imageio.load(ref).rgb
            rw, rh = model_size(r.shape[1], r.shape[0], 0.5)
            reference = cv2.resize(r, (rw, rh), interpolation=cv2.INTER_AREA)
            prompt += " Use the garment from the reference image."
        seed = int(params.get("seed", 1234)) + int(ctx.fixes.get("seed_offset", 0)) * 7919
        ctx.on_progress("ИИ-редактирование одежды", 0.5)
        try:
            out = ctx.comfy.edit(small, prompt, seed=seed, reference=reference)
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            raise OperationError(f"Модель редактирования не отработала: {msg}",
                                 transient="memory" in msg.lower() or "timed out" in msg.lower()) from e
        ctx.checkpoint()
        edited_crop = cv2.resize(out, (x1 - x0, y1 - y0), interpolation=cv2.INTER_CUBIC)
        edited = rgb.copy()
        edited[y0:y1, x0:x1] = edited_crop
        k = max(9, int(0.02 * max(h, w))) | 1
        ring = (cv2.dilate((edit > 0.5).astype(np.uint8), np.ones((k, k), np.uint8)) > 0) & (edit < 0.5)
        ring[:y0], ring[y1:], ring[:, :x0], ring[:, x1:] = False, False, False, False
        edited = match_colors(edited, rgb, ring)
        feather = max(1.5, 0.003 * max(h, w))
        m = imgutil.feather(edit, feather)
        m = np.where(prot > 0.5, 0.0, m)  # защищённые пиксели — строго из исходника
        before = ctx.photo.rgb.copy()
        result = before * (1 - m[..., None]) + edited * m[..., None]
        ctx.info["before_ai"] = before
        ctx.masks["edit"] = edit
        ctx.masks["protected"] = prot
        change = float(np.abs(result - before)[edit > 0.5].mean()) if (edit > 0.5).any() else 0.0
        ctx.info["clothes_change"] = change
        ctx.photo.rgb = np.clip(result, 0, 1).astype(np.float32)
        if ctx.photo.alpha is not None:
            # Одежда могла выйти за прежний силуэт: расширяем прозрачность там, где дорисована ткань
            ctx.photo.alpha = np.maximum(ctx.photo.alpha, m * (np.abs(edited - rgb).mean(-1) > 0.08))
        ctx.note(self.id, f"Одежда заменена: {garment}", seed=seed, change=round(change, 3), faces=len(found))
