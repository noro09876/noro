"""Пути и настройки PhotoAgent.

Все данные (оригиналы, промежуточные и готовые файлы, модели, база заданий)
лежат в одной папке данных на компьютере пользователя. По умолчанию это
`photoagent_data` рядом с папкой проекта; переопределяется переменной
окружения PHOTOAGENT_DATA.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Settings:
    data_dir: Path
    models_dir: Path
    host: str = "127.0.0.1"
    port: int = 8765
    # Сколько раз повторять кадр после временной ошибки (нехватка памяти и т.п.)
    max_transient_retries: int = 2
    # Сколько раз исправлять кадр после найденного дефекта качества
    max_quality_retries: int = 2
    # Верхний предел длинной стороны изображения, которое отдаётся нейросети.
    # Сама картинка не уменьшается: модель получает уменьшенную копию,
    # результат (маска) масштабируется обратно.
    max_model_side: int = 2048
    # Адрес локального ComfyUI (необязательный компонент для ИИ-редактирования)
    comfyui_url: str = "http://127.0.0.1:8188"
    # Адрес локального Ollama (необязательный, для разбора сложных заданий)
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = ""
    onnx_providers: list[str] = field(default_factory=list)

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "photoagent.sqlite3"

    def ensure(self) -> None:
        for p in (self.data_dir, self.models_dir, self.jobs_dir):
            p.mkdir(parents=True, exist_ok=True)


def load_settings(data_dir: str | os.PathLike | None = None) -> Settings:
    base = Path(data_dir or os.environ.get("PHOTOAGENT_DATA") or PROJECT_ROOT / "photoagent_data")
    models = Path(os.environ.get("PHOTOAGENT_MODELS") or base / "models")
    s = Settings(data_dir=base.resolve(), models_dir=models.resolve())
    if os.environ.get("PHOTOAGENT_PORT"):
        s.port = int(os.environ["PHOTOAGENT_PORT"])
    if os.environ.get("PHOTOAGENT_COMFYUI"):
        s.comfyui_url = os.environ["PHOTOAGENT_COMFYUI"].rstrip("/")
    if os.environ.get("PHOTOAGENT_OLLAMA_MODEL"):
        s.ollama_model = os.environ["PHOTOAGENT_OLLAMA_MODEL"]
    if os.environ.get("PHOTOAGENT_MAX_MODEL_SIDE"):
        s.max_model_side = int(os.environ["PHOTOAGENT_MAX_MODEL_SIDE"])
    if os.environ.get("PHOTOAGENT_ONNX_PROVIDERS"):
        s.onnx_providers = [p.strip() for p in os.environ["PHOTOAGENT_ONNX_PROVIDERS"].split(",") if p.strip()]
    s.ensure()
    return s
