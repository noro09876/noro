"""Операции обработки. Импорт модулей регистрирует операции в OPERATIONS."""
from . import background, clothes, color, composite, enhance  # noqa: F401
from .base import OPERATIONS, FrameContext, Operation, OperationError, get, register  # noqa: F401
