"""Планировщик: из спецификации задания строит упорядоченный список шагов.

Порядок шагов фиксирован правилами (шум → свет/цвет → кожа → фон → одежда →
композитинг → резкость/увеличение → итоговый размер), поэтому одно и то же
задание всегда обрабатывается одинаково. Новая операция добавляется в ORDER.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import models as modelreg
from .interpreter import TaskSpec
from .ops import OPERATIONS

# Базовый порядок. change_clothes переставляется в зависимости от замены фона.
ORDER = [
    "denoise", "white_balance", "exposure_contrast", "skin_tone", "blemishes", "saturation",
    "change_clothes", "remove_background", "replace_background", "sharpen", "upscale", "resize",
]


@dataclass
class Plan:
    steps: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"steps": self.steps, "errors": self.errors, "warnings": self.warnings}


def build_plan(spec: TaskSpec, ref_roles: set[str], env: dict) -> Plan:
    """env: {"models_dir": Path, "comfyui": bool}"""
    plan = Plan()
    ops = dict(spec.ops)
    if not ops:
        plan.errors.append("В задании не найдено ни одной операции обработки. "
                           "Опишите, что сделать: например, «удали фон», «исправь цвет», «убери шум».")
        return plan
    order = list(ORDER)
    if "change_clothes" in ops and "replace_background" in ops:
        # Одежда дорисовывается уже в новом интерьере: свет и тени ткани получаются согласованными
        order.remove("change_clothes")
        order.insert(order.index("replace_background") + 1, "change_clothes")
    if spec.export.get("resolution") == "original" and "upscale" not in ops:
        ops["resize"] = {"mode": "original"}

    for op_id in order:
        if op_id not in ops:
            continue
        op = OPERATIONS.get(op_id)
        if op is None:
            plan.errors.append(f"Операция «{op_id}» пока не реализована.")
            continue
        params = dict(ops[op_id])
        if op_id == "change_clothes":
            params.setdefault("preserve", spec.preserve)
        step = {"op": op_id, "title": op.title, "params": params}
        for role, desc in op.needs_refs.items():
            if op_id == "replace_background" and params.get("color"):
                continue
            if role not in ref_roles:
                plan.errors.append(f"Для шага «{op.title}» загрузите {desc}.")
        if op.needs_comfyui and not env.get("comfyui"):
            plan.errors.append(
                f"Шаг «{op.title}» требует локальный ComfyUI с моделью редактирования. "
                "Он не запущен или не установлен — см. раздел «Система».")
        for mid in op.models:
            if not modelreg.is_installed(env["models_dir"], mid):
                plan.errors.append(f"Для шага «{op.title}» скачайте модель «{modelreg.MODELS[mid].title}» в разделе «Модели».")
        plan.steps.append(step)

    if "remove_background" in ops:
        if not (modelreg.is_installed(env["models_dir"], "birefnet_portrait")
                or modelreg.is_installed(env["models_dir"], "birefnet_lite")):
            if ops["remove_background"].get("method") == "chroma":
                plan.warnings.append("Модель BiRefNet не скачана: фон будет удалён только хромакеем, "
                                     "без нейросетевой страховки.")
            else:
                plan.errors.append("Для удаления фона скачайте модель BiRefNet (раздел «Модели»).")
    if not (modelreg.is_installed(env["models_dir"], "yunet") and modelreg.is_installed(env["models_dir"], "sface")):
        plan.warnings.append("Модели лиц (YuNet/SFace) не скачаны: проверка сохранения лица будет пропущена.")
    if spec.unrecognized:
        plan.warnings.append("Не понял часть задания: «" + "», «".join(spec.unrecognized) +
                             "». Эти фрагменты не будут выполнены — переформулируйте их.")
    plan.warnings.extend(spec.notes)
    return plan
