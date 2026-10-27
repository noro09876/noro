"""Шумоподавление, удаление мелких дефектов кожи, увеличение разрешения."""
from __future__ import annotations

import cv2
import numpy as np

from .. import faces as facemod
from .. import imgutil
from ..imageio import to_uint8
from ..models import ModelMissing
from .base import FrameContext, Operation, OperationError, register


@register
class Denoise(Operation):
    id = "denoise"
    title = "Шумоподавление"

    def run(self, ctx: FrameContext, params: dict) -> None:
        rgb = ctx.photo.rgb
        sigma = imgutil.estimate_noise(imgutil.luma(rgb))
        ctx.info["noise_sigma"] = sigma
        level = float(params.get("strength", 1.0))
        if sigma < 0.006 and not params.get("force"):
            ctx.note(self.id, f"Шум низкий ({sigma * 255:.1f}/255) — шумоподавление не требуется")
            return
        h_l = float(np.clip(sigma * 255 * 1.1 * level, 3, 18))
        h_c = h_l * 1.2
        u8 = cv2.cvtColor(to_uint8(rgb), cv2.COLOR_RGB2BGR)
        den = cv2.fastNlMeansDenoisingColored(u8, None, h_l, h_c, 7, 21)
        den = cv2.cvtColor(den, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        # Возвращаем часть мелкой текстуры: «пластиковая» кожа хуже лёгкого зерна
        keep = float(params.get("keep_texture", 0.25))
        # для 16-битных исходников переносим именно разницу, чтобы не терять градации
        out = rgb + (den - to_uint8(rgb).astype(np.float32) / 255.0) * (1 - keep)
        ctx.photo.rgb = np.clip(out, 0, 1).astype(np.float32)
        ctx.note(self.id, "Шумоподавление", sigma=round(sigma * 255, 2), h=round(h_l, 1))


@register
class Blemishes(Operation):
    id = "blemishes"
    title = "Удаление мелких дефектов кожи"

    def run(self, ctx: FrameContext, params: dict) -> None:
        rgb = ctx.photo.rgb
        h, w = rgb.shape[:2]
        try:
            found = facemod.detect(ctx.cache, rgb)
        except ModelMissing:
            ctx.warn("Модель поиска лиц не скачана: ретушь кожи пропущена.")
            return
        if not found:
            ctx.note(self.id, "Лица не найдены — ретушь кожи пропущена")
            return
        strength = float(params.get("strength", 1.0))
        region = facemod.face_mask((h, w), found, scale=1.05)
        # Глаза, брови, губы и ноздри — не дефекты: исключаем их
        protect = np.zeros((h, w), np.uint8)
        for f in found:
            fw = f.box[2]
            for (x, y), k in zip(f.landmarks, (0.16, 0.16, 0.09, 0.0, 0.0)):
                if k:
                    cv2.circle(protect, (int(x), int(y)), int(fw * k), 1, -1)
            # рот — эллипс между уголками
            (mx1, my1), (mx2, my2) = f.landmarks[3], f.landmarks[4]
            cx, cy = (mx1 + mx2) / 2, (my1 + my2) / 2
            cv2.ellipse(protect, (int(cx), int(cy)), (int(abs(mx2 - mx1) * 0.75), int(fw * 0.1)), 0, 0, 360, 1, -1)
            # брови — полоса над глазами
            (ex1, ey1), (ex2, ey2) = f.landmarks[0], f.landmarks[1]
            cv2.rectangle(protect, (int(min(ex1, ex2) - fw * 0.2), int(min(ey1, ey2) - fw * 0.22)),
                          (int(max(ex1, ex2) + fw * 0.2), int(min(ey1, ey2) - fw * 0.05)), 1, -1)
        skin = (imgutil.skin_probability(rgb) > 0.35) & (region > 0.5) & (protect == 0)
        if skin.sum() < 500:
            return
        lab = imgutil.to_lab(rgb)
        L = lab[..., 0]
        face_w = max(f.box[2] for f in found)
        r = max(2.0, face_w * 0.02)
        base = cv2.GaussianBlur(L, (0, 0), r * 1.5)
        dark = base - L  # тёмные точки (прыщики, родинки малого размера, пылинки)
        red = lab[..., 1] - cv2.GaussianBlur(lab[..., 1], (0, 0), r * 1.5)
        thr = 5.5 / strength
        cand = skin & ((dark > thr) | ((red > 5.0 / strength) & (dark > thr * 0.4)))
        cand_u8 = cand.astype(np.uint8)
        n, lab_cc, stats, _ = cv2.connectedComponentsWithStats(cand_u8, 8)
        max_area = np.pi * (face_w * 0.035) ** 2
        min_area = 3
        keep = np.zeros(n, bool)
        for i in range(1, n):
            a = stats[i, cv2.CC_STAT_AREA]
            bw, bh = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
            if min_area <= a <= max_area and max(bw, bh) <= 3.0 * min(bw, bh) + 2:
                keep[i] = True
        spots = keep[lab_cc]
        count = int(keep.sum())
        if count == 0:
            ctx.note(self.id, "Заметных дефектов кожи не найдено")
            return
        m = cv2.dilate(spots.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
        u8 = cv2.cvtColor(to_uint8(rgb), cv2.COLOR_RGB2BGR)
        healed = cv2.inpaint(u8, m, max(3, int(r)), cv2.INPAINT_TELEA)
        healed = cv2.cvtColor(healed, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        # Сохраняем естественную фактуру: переносим высокие частоты кожи из окрестности
        hf = rgb - cv2.GaussianBlur(rgb, (0, 0), 1.2)
        hf_shift = np.roll(hf, int(r * 2) + 1, axis=1)
        blend = imgutil.feather(m.astype(np.float32), 1.5)[..., None]
        healed = cv2.GaussianBlur(healed, (0, 0), 1.2) + hf_shift * 0.8
        ctx.photo.rgb = np.clip(rgb * (1 - blend) + healed * blend, 0, 1).astype(np.float32)
        ctx.note(self.id, f"Исправлено мелких дефектов кожи: {count}")


@register
class Upscale(Operation):
    id = "upscale"
    title = "Увеличение разрешения"

    def run(self, ctx: FrameContext, params: dict) -> None:
        h, w = ctx.photo.rgb.shape[:2]
        factor = float(params.get("factor", 0) or 0)
        long_side = int(params.get("long_side", 0) or 0)
        if long_side:
            factor = long_side / max(h, w)
        if factor <= 1.01:
            ctx.note(self.id, "Увеличение не требуется")
            return
        factor = min(factor, 4.0)
        size = (round(w * factor), round(h * factor))
        if size[0] * size[1] > 120e6:
            raise OperationError(f"Итоговый размер {size[0]}×{size[1]} слишком велик (больше 120 Мп)")
        method = "classic"
        # Нейросеть увеличивает в 4 раза; для больших кадров это не помещается в память
        if ctx.comfy is not None and params.get("ai", True) and w * h * 16 <= 150e6:
            try:
                ctx.photo.rgb = ctx.comfy.upscale(ctx.photo.rgb, factor)
                if ctx.photo.rgb.shape[1::-1] != size:
                    ctx.photo.rgb = imgutil.resize_to(ctx.photo.rgb, size, cv2.INTER_AREA)
                method = "ai"
            except Exception as e:  # noqa: BLE001
                ctx.warn(f"ИИ-увеличение недоступно ({e}); использовано классическое.")
        if method == "classic":
            up = cv2.resize(ctx.photo.rgb, size, interpolation=cv2.INTER_LANCZOS4)
            blur = cv2.GaussianBlur(up, (0, 0), 1.0 * factor / 2)
            ctx.photo.rgb = np.clip(up + (up - blur) * 0.35, 0, 1).astype(np.float32)
        if ctx.photo.alpha is not None:
            ctx.photo.alpha = np.clip(cv2.resize(ctx.photo.alpha, size, interpolation=cv2.INTER_CUBIC), 0, 1)
        for k in list(ctx.masks):
            ctx.masks[k] = np.clip(cv2.resize(ctx.masks[k], size, interpolation=cv2.INTER_LINEAR), 0, 1)
        ctx.note(self.id, f"Увеличение ×{factor:.2f} ({'нейросеть' if method == 'ai' else 'Lanczos + резкость'})",
                 size=list(size))


@register
class Sharpen(Operation):
    id = "sharpen"
    title = "Повышение резкости"

    def run(self, ctx: FrameContext, params: dict) -> None:
        amount = float(params.get("amount", 0.4))
        rgb = ctx.photo.rgb
        h, w = rgb.shape[:2]
        radius = max(0.8, max(h, w) / 3000)
        blur = cv2.GaussianBlur(rgb, (0, 0), radius)
        detail = rgb - blur
        # Порог, чтобы не усиливать шум на ровных участках
        mag = np.abs(imgutil.luma(detail))[..., None]
        mask = np.clip((mag - 0.004) / 0.01, 0, 1)
        ctx.photo.rgb = np.clip(rgb + detail * amount * mask, 0, 1).astype(np.float32)
        ctx.note(self.id, "Резкость", amount=amount)


@register
class Resize(Operation):
    """Итоговый размер: «сохрани исходное разрешение» или конкретная длинная сторона."""
    id = "resize"
    title = "Итоговый размер"

    def run(self, ctx: FrameContext, params: dict) -> None:
        h, w = ctx.photo.rgb.shape[:2]
        mode = params.get("mode", "original")
        if mode == "original":
            ow, oh = ctx.original.size
            size = (ow, oh)
        elif mode == "long_side":
            s = int(params["long_side"]) / max(h, w)
            size = (round(w * s), round(h * s))
        else:
            raise OperationError(f"Неизвестный режим размера: {mode}")
        if size == (w, h):
            return
        interp = cv2.INTER_AREA if size[0] < w else cv2.INTER_LANCZOS4
        ctx.photo.rgb = np.clip(cv2.resize(ctx.photo.rgb, size, interpolation=interp), 0, 1)
        if ctx.photo.alpha is not None:
            ctx.photo.alpha = np.clip(cv2.resize(ctx.photo.alpha, size, interpolation=cv2.INTER_AREA if size[0] < w else cv2.INTER_CUBIC), 0, 1)
        for k in list(ctx.masks):
            ctx.masks[k] = np.clip(cv2.resize(ctx.masks[k], size, interpolation=cv2.INTER_LINEAR), 0, 1)
        ctx.note(self.id, f"Размер {size[0]}×{size[1]}")
