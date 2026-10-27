"""Автоматический контроль качества каждого кадра.

Проверки измеряют то, что можно измерить надёжно: файл, размер, пустоту,
качество маски, цветной ореол, согласованность композитинга, сохранность
лица (сравнение SFace с оригиналом) и неизменность защищённых областей.
Художественное качество автоматикой не гарантируется: сомнительные кадры
уходят в список «на проверку», а не объявляются готовыми.

Каждая найденная проблема может нести `fix` — поправки для повторной
обработки (их применяют операции через ctx.fixes).
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path

import cv2
import numpy as np

from . import faces as facemod
from . import imageio, imgutil
from .ops.base import FrameContext

ERROR, WARN, INFO = "error", "warn", "info"


@dataclass
class Issue:
    code: str
    severity: str
    message: str
    fix: dict | None = None
    value: float | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def score(issues: list[Issue]) -> float:
    return sum({ERROR: 10.0, WARN: 1.0, INFO: 0.0}[i.severity] for i in issues)


def check_file(path: Path, expect_size: tuple[int, int], expect_alpha: bool) -> list[Issue]:
    out: list[Issue] = []
    try:
        p = imageio.load(path)
    except Exception as e:  # noqa: BLE001
        return [Issue("file_unreadable", ERROR, f"Сохранённый файл не открывается: {e}")]
    if p.size != tuple(expect_size):
        out.append(Issue("size_mismatch", ERROR,
                         f"Размер {p.size[0]}×{p.size[1]} вместо ожидаемого {expect_size[0]}×{expect_size[1]}"))
    if expect_alpha and p.alpha is None:
        out.append(Issue("alpha_missing", ERROR, "В файле нет прозрачности, хотя фон должен быть удалён"))
    small, _ = imgutil.limit_side(p.rgb, 512)
    if float(small.std()) < 0.01:
        out.append(Issue("empty_image", ERROR, "Изображение пустое или однотонное"))
    if not np.isfinite(small).all():
        out.append(Issue("corrupt_pixels", ERROR, "В изображении повреждённые значения"))
    return out


def check_mask(ctx: FrameContext) -> list[Issue]:
    alpha = ctx.masks.get("subject")
    if alpha is None:
        return []
    out: list[Issue] = []
    cover = float((alpha > 0.5).mean())
    if cover < 0.01:
        out.append(Issue("subject_missing", ERROR, "Объект почти не найден: маска пустая", value=cover))
    elif cover > 0.97:
        out.append(Issue("background_not_removed", ERROR, "Фон почти не удалён: маска заняла весь кадр",
                         fix={"key_tolerance": 1.6}, value=cover))
    ai = ctx.masks.get("ai_subject")
    if ai is not None and cover >= 0.01:
        h, w = alpha.shape
        k = max(3, int(0.01 * max(h, w))) | 1
        core = cv2.erode((ai > 0.95).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0
        inter = float(((alpha > 0.5) & (ai > 0.5)).sum())
        union = float(((alpha > 0.5) | (ai > 0.5)).sum())
        iou = inter / max(union, 1.0)
        if iou < 0.8:
            out.append(Issue("mask_disagreement", WARN,
                             f"Хромакей и нейросеть по-разному видят объект (совпадение {iou:.0%}) — проверьте маску",
                             value=iou))
        holes = float(((alpha < 0.5) & core).sum() / max(core.sum(), 1))
        if holes > 0.01:
            out.append(Issue("mask_holes", WARN, f"В маске человека есть дыры ({holes:.1%} площади)",
                             fix={"key_tolerance": 0.7}, value=holes))
    # Полупрозрачная «дымка»: слишком много промежуточных значений вдали от краёв
    semi = (alpha > 0.1) & (alpha < 0.9)
    edge = cv2.morphologyEx((alpha > 0.5).astype(np.uint8), cv2.MORPH_GRADIENT,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))) > 0
    fog = float((semi & ~edge).sum() / max(alpha.size, 1))
    if fog > 0.01:
        out.append(Issue("mask_fog", WARN, f"Полупрозрачная «дымка» в маске вдали от краёв ({fog:.1%} кадра)",
                         fix={"key_tolerance": 1.3}, value=fog))
    return out


def check_halo(ctx: FrameContext) -> list[Issue]:
    screen = ctx.info.get("screen")
    alpha = ctx.masks.get("subject")
    if alpha is None or not screen:
        return []
    rgb = ctx.photo.rgb
    ring = cv2.morphologyEx((alpha > 0.5).astype(np.uint8), cv2.MORPH_GRADIENT,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) > 0
    if ctx.photo.alpha is not None:
        ring &= ctx.photo.alpha > 0.05
    if ring.sum() < 100:
        return []
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ex = (g - np.maximum(r, b)) if screen == "green" else (b - np.maximum(r, g))
    base = 0.0
    bg = ctx.info.get("background_layer")
    if bg is not None:
        bex = (bg[..., 1] - np.maximum(bg[..., 0], bg[..., 2])) if screen == "green" else (bg[..., 2] - np.maximum(bg[..., 0], bg[..., 1]))
        base = float(np.mean(np.maximum(bex[ring], 0)))
    spill = float(np.mean(np.maximum(ex[ring], 0))) - base
    if spill > 0.025:
        return [Issue("color_halo", WARN, f"Заметный {'зелёный' if screen == 'green' else 'синий'} ореол по контуру",
                      fix={"despill_boost": 1.4, "alpha_erode": 1}, value=spill)]
    return []


def check_composite(ctx: FrameContext) -> list[Issue]:
    """Сравнивает цвет освещения (по нейтральным участкам) и яркость человека и окружения."""
    if not ctx.info.get("composited"):
        return []
    from .ops.composite import neutral_cast, ring_mask
    alpha = ctx.masks["subject"]
    bg = ctx.info.get("background_layer")
    if bg is None or alpha.shape != ctx.photo.rgb.shape[:2] or bg.shape[:2] != alpha.shape:
        return []
    solid = (alpha > 0.95).astype(np.float32)
    ring = ring_mask(alpha).astype(np.float32)
    if solid.sum() < 1000:
        return []
    lab_f = imgutil.to_lab(ctx.photo.rgb)
    lab_b = imgutil.to_lab(bg)
    out = []
    cf, nf = neutral_cast(lab_f, solid)
    cb, nb = neutral_cast(lab_b, ring)
    if nf >= 300 and nb >= 300:
        d_ab = float(np.hypot(*(cf - cb)))
        if d_ab > 9:
            out.append(Issue("color_mismatch", WARN,
                             f"Оттенок освещения на человеке и на фоне различается (Δab={d_ab:.0f})",
                             fix={"harmonize_boost": 1.5}, value=d_ab))
    Lf = float(np.median(lab_f[..., 0][solid > 0.5]))
    Lb = float(np.median(lab_b[..., 0][ring > 0.5]))
    if abs(Lf - Lb) > 45:
        out.append(Issue("light_mismatch", WARN,
                         f"Яркость человека сильно отличается от окружения (ΔL={abs(Lf - Lb):.0f})",
                         fix={"harmonize_boost": 1.5}, value=abs(Lf - Lb)))
    return out


def check_faces(ctx: FrameContext, threshold: float = 0.7) -> tuple[list[Issue], dict]:
    """Сравнивает лица оригинала и результата. Возвращает проблемы и метрики."""
    metrics: dict = {}
    orig = facemod.safe_detect(ctx.cache, ctx.original.rgb)
    if orig is None:
        return [Issue("face_check_skipped", INFO, "Проверка лица пропущена: модели лиц не скачаны")], metrics
    if not orig:
        metrics["faces"] = 0
        return [], metrics
    # Сравниваем в геометрии оригинала (если кадр увеличивали — уменьшаем обратно)
    res_rgb = ctx.photo.rgb
    if ctx.photo.alpha is not None:
        a = ctx.photo.alpha[..., None]
        res_rgb = res_rgb * a + 0.5 * (1 - a)
    if res_rgb.shape[:2] != ctx.original.rgb.shape[:2]:
        res_rgb = imgutil.resize_to(res_rgb, ctx.original.size, cv2.INTER_AREA)
    res = facemod.detect(ctx.cache, res_rgb)
    metrics["faces"] = len(orig)
    metrics["faces_result"] = len(res)
    issues: list[Issue] = []
    pairs = facemod.match_faces(orig, res)
    sims = []
    big = [i for i, f in enumerate(orig) if f.box[2] >= 40]
    matched = {i for i, _ in pairs}
    for i in big:
        if i not in matched:
            issues.append(Issue("face_lost", ERROR, "Лицо не найдено на результате — возможно искажение или перекрытие",
                                fix={"protect_face_more": True}))
    for i, j in pairs:
        if orig[i].box[2] < 40:
            continue  # слишком мелкие лица сравнивать ненадёжно
        e1 = facemod.embedding(ctx.cache, ctx.original.rgb, orig[i])
        e2 = facemod.embedding(ctx.cache, res_rgb, res[j])
        s = facemod.similarity(ctx.cache, e1, e2)
        sims.append(round(s, 3))
        if s < threshold:
            issues.append(Issue("face_changed", ERROR,
                                f"Лицо заметно изменилось (сходство {s:.2f} при пороге {threshold})",
                                fix={"protect_face_more": True}, value=s))
    metrics["face_similarity"] = sims
    return issues, metrics


def check_protected(ctx: FrameContext) -> list[Issue]:
    """После ИИ-редактирования защищённые области (лицо, руки) должны остаться прежними."""
    prot = ctx.masks.get("protected")
    before = ctx.info.get("before_ai")
    if prot is None or before is None:
        return []
    m = prot > 0.9
    if m.sum() < 100:
        return []
    diff = float(np.abs(ctx.photo.rgb[m] - before[m]).mean())
    if diff > 0.02:
        return [Issue("protected_changed", ERROR, f"Изменились защищённые области (лицо/руки), отклонение {diff:.3f}",
                      fix={"protect_face_more": True}, value=diff)]
    return []


def check_new_skin(ctx: FrameContext) -> list[Issue]:
    """Лишние руки/пальцы: в области новой одежды появилась кожа, которой не было."""
    edit = ctx.masks.get("edit")
    before = ctx.info.get("before_ai")
    if edit is None or before is None:
        return []
    m = edit > 0.5
    if m.sum() < 1000:
        return []
    new_skin = (imgutil.skin_probability(ctx.photo.rgb) > 0.6) & m
    old_skin = (imgutil.skin_probability(before) > 0.6) & m
    grown = float((new_skin.sum() - old_skin.sum()) / m.sum())
    if grown > 0.03:
        return [Issue("extra_skin", WARN,
                      f"В области одежды появилась кожа ({grown:.1%}) — возможны лишние руки или пальцы",
                      fix={"reseed": True}, value=grown)]
    return []


def check_task(ctx: FrameContext, steps: list[dict]) -> list[Issue]:
    out = []
    ops = {s["op"] for s in steps}
    if "remove_background" in ops and "replace_background" not in ops and ctx.photo.alpha is None:
        out.append(Issue("task_bg", ERROR, "Фон должен быть удалён, но прозрачности нет"))
    if "replace_background" in ops and not ctx.info.get("composited"):
        out.append(Issue("task_composite", ERROR, "Фон не был заменён"))
    if "change_clothes" in ops:
        changed = ctx.info.get("clothes_change")
        if changed is not None and changed < 0.04:
            out.append(Issue("task_clothes", WARN, f"Одежда почти не изменилась (среднее изменение {changed:.3f})",
                             fix={"reseed": True, "edit_strength_boost": 1.15}, value=changed))
    return out


def check_clipping(ctx: FrameContext) -> list[Issue]:
    def clipped(rgb: np.ndarray) -> float:
        s, _ = imgutil.limit_side(rgb, 800)
        return float(((s.max(-1) > 0.995) | (s.min(-1) < 0.003)).mean())
    a, b = clipped(ctx.original.rgb), clipped(ctx.photo.rgb)
    if b - a > 0.04 and not ctx.info.get("composited") and ctx.photo.alpha is None:
        return [Issue("clipping", WARN, f"Выросла доля пересвеченных/провалившихся пикселей (+{(b - a):.1%})",
                      fix={"exposure_scale": 0.5}, value=b - a)]
    return []


def run_all(ctx: FrameContext, steps: list[dict], saved: Path | None, expect_size: tuple[int, int],
            expect_alpha: bool, face_threshold: float = 0.7) -> tuple[list[Issue], dict]:
    issues: list[Issue] = []
    metrics: dict = {}
    if saved is not None:
        issues += check_file(saved, expect_size, expect_alpha)
    issues += check_mask(ctx)
    issues += check_halo(ctx)
    issues += check_composite(ctx)
    fi, fm = check_faces(ctx, face_threshold)
    issues += fi
    metrics.update(fm)
    issues += check_protected(ctx)
    issues += check_new_skin(ctx)
    issues += check_task(ctx, steps)
    issues += check_clipping(ctx)
    metrics["score"] = score(issues)
    return issues, metrics
