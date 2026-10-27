"""Каркас операций обработки.

Каждая операция — класс с id, русским названием и методом run(ctx, params).
Операции регистрируются декоратором @register и становятся доступны
планировщику без изменений в остальном коде.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import numpy as np

from ..config import Settings
from ..imageio import Photo
from ..models import ModelCache


class OperationError(Exception):
    """Ошибка операции с понятным пользователю текстом."""

    def __init__(self, message: str, transient: bool = False):
        super().__init__(message)
        self.transient = transient


class Cancelled(Exception):
    pass


@dataclass
class FrameContext:
    original: Photo
    photo: Photo
    settings: Settings
    cache: ModelCache
    spec: dict
    refs: dict[str, list[Path]] = field(default_factory=dict)
    masks: dict[str, np.ndarray] = field(default_factory=dict)
    info: dict[str, Any] = field(default_factory=dict)
    log: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    workdir: Path | None = None
    attempt: int = 0
    # Поправки, которые контроль качества просит применить при повторе
    fixes: dict[str, Any] = field(default_factory=dict)
    comfy: Any = None
    should_stop: Callable[[], bool] = lambda: False
    on_progress: Callable[[str, float], None] = lambda step, p: None

    def note(self, op: str, message: str, **data: Any) -> None:
        self.log.append({"op": op, "message": message, **data})

    def warn(self, message: str) -> None:
        if message not in self.warnings:
            self.warnings.append(message)

    def checkpoint(self) -> None:
        if self.should_stop():
            raise Cancelled()

    def ref(self, role: str) -> Path | None:
        items = self.refs.get(role) or []
        return items[0] if items else None


class Operation:
    id: str = ""
    title: str = ""
    # Какие референсы нужны: роль -> описание для сообщения об ошибке
    needs_refs: dict[str, str] = {}
    # Какие модели нужны (id из models.MODELS); если нет — операция недоступна
    models: tuple[str, ...] = ()
    # Нужен ли локальный ComfyUI
    needs_comfyui: bool = False
    # Какие поправки контроля качества (ctx.fixes) влияют на операцию: при повторе
    # обработка возобновляется с первой такой операции, а не с начала
    fix_keys: tuple[str, ...] = ()

    def run(self, ctx: FrameContext, params: dict) -> None:
        raise NotImplementedError


OPERATIONS: dict[str, Operation] = {}


def register(cls: type[Operation]) -> type[Operation]:
    OPERATIONS[cls.id] = cls()
    return cls


def get(op_id: str) -> Operation:
    try:
        return OPERATIONS[op_id]
    except KeyError:
        raise OperationError(f"Неизвестная операция: {op_id}") from None
