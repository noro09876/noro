"""Реестр локальных моделей: откуда скачать, лицензия, контрольная сумма.

Модели скачиваются только по нажатию кнопки в интерфейсе (или командой
`python -m photoagent models download <id>`). Ничего не загружается
автоматически, фотографии никуда не отправляются: скачиваются только веса.

Добавить модель = добавить запись в MODELS. Код операций обращается к модели
по id через ModelCache, поэтому замена весов не требует переделки системы.
"""
from __future__ import annotations

import gc
import hashlib
import os
import threading
import time
import urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Callable

import numpy as np


@dataclass(frozen=True)
class ModelInfo:
    id: str
    title: str
    purpose: str
    file: str
    url: str
    sha256: str
    size_mb: int
    license: str
    license_url: str
    commercial_ok: bool
    required: bool = False  # без неё базовые операции работают хуже, но работают


MODELS: dict[str, ModelInfo] = {m.id: m for m in [
    ModelInfo(
        id="birefnet_portrait",
        title="BiRefNet Portrait",
        purpose="Выделение человека и волос, маска для удаления и замены фона",
        file="BiRefNet-portrait-epoch_150.onnx",
        url="https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-portrait-epoch_150.onnx",
        sha256="1ba1c8ff5a7bbfadc8d8d13fb11d7be793f91f23d9d466549e37a854f6668f99",
        size_mb=928,
        license="MIT",
        license_url="https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE",
        commercial_ok=True,
        required=True,
    ),
    ModelInfo(
        id="birefnet_lite",
        title="BiRefNet Lite",
        purpose="Облегчённое выделение объекта (запасной вариант при нехватке памяти)",
        file="BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
        url="https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
        sha256="5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333",
        size_mb=214,
        license="MIT",
        license_url="https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE",
        commercial_ok=True,
    ),
    ModelInfo(
        id="yunet",
        title="YuNet (OpenCV Zoo)",
        purpose="Поиск лиц: защита лица при редактировании и контроль качества",
        file="face_detection_yunet_2023mar.onnx",
        url="https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        sha256="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        size_mb=1,
        license="MIT",
        license_url="https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE",
        commercial_ok=True,
        required=True,
    ),
    ModelInfo(
        id="sface",
        title="SFace (OpenCV Zoo)",
        purpose="Сравнение лица до и после обработки (сохранение личности)",
        file="face_recognition_sface_2021dec.onnx",
        url="https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        sha256="0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        size_mb=37,
        license="Apache-2.0",
        license_url="https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/LICENSE",
        commercial_ok=True,
        required=True,
    ),
]}


class ModelMissing(Exception):
    def __init__(self, model_id: str):
        info = MODELS.get(model_id)
        title = info.title if info else model_id
        super().__init__(f"Модель «{title}» не скачана. Откройте раздел «Модели» и нажмите «Скачать».")
        self.model_id = model_id


def model_path(models_dir: Path, model_id: str) -> Path:
    return Path(models_dir) / MODELS[model_id].file


def is_installed(models_dir: Path, model_id: str) -> bool:
    p = model_path(models_dir, model_id)
    return p.exists() and p.stat().st_size > 0


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def status(models_dir: Path) -> list[dict]:
    out = []
    for m in MODELS.values():
        d = asdict(m)
        d["installed"] = is_installed(models_dir, m.id)
        out.append(d)
    return out


_download_state: dict[str, dict] = {}
_download_lock = threading.Lock()


def download_state() -> dict[str, dict]:
    with _download_lock:
        return {k: dict(v) for k, v in _download_state.items()}


def download(models_dir: Path, model_id: str, progress: Callable[[int, int], None] | None = None) -> Path:
    """Скачивает веса с проверкой SHA-256. Повторный вызов докачивает файл заново."""
    info = MODELS[model_id]
    dest = model_path(models_dir, model_id)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".download")
    with _download_lock:
        _download_state[model_id] = {"done": 0, "total": info.size_mb * 1024 * 1024, "status": "downloading", "error": ""}
    try:
        req = urllib.request.Request(info.url, headers={"User-Agent": "PhotoAgent"})
        with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
            total = int(r.headers.get("Content-Length") or 0)
            done = 0
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                with _download_lock:
                    _download_state[model_id].update(done=done, total=total or done)
                if progress:
                    progress(done, total)
        digest = sha256_file(tmp)
        if digest != info.sha256:
            tmp.unlink(missing_ok=True)
            raise IOError(f"Контрольная сумма не совпала для {info.title}: файл повреждён или подменён")
        os.replace(tmp, dest)
        with _download_lock:
            _download_state[model_id]["status"] = "done"
        return dest
    except Exception as e:
        with _download_lock:
            _download_state[model_id].update(status="error", error=str(e))
        raise


def available_onnx_providers(preferred: list[str] | None = None) -> list[str]:
    import onnxruntime as ort
    have = ort.get_available_providers()
    order = preferred or ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]
    return [p for p in order if p in have] or ["CPUExecutionProvider"]


class ModelCache:
    """Держит загруженные модели и выгружает их, чтобы не переполнять видеопамять.

    Одновременно в памяти остаётся не больше `max_loaded` тяжёлых моделей;
    операции явно вызывают release() после серии кадров.
    """

    def __init__(self, models_dir: Path, providers: list[str] | None = None, max_loaded: int = 1):
        self.models_dir = Path(models_dir)
        self.providers = available_onnx_providers(providers or None)
        self.max_loaded = max_loaded
        self._items: dict[str, tuple[object, float]] = {}
        self._lock = threading.RLock()

    def onnx(self, model_id: str):
        with self._lock:
            if model_id in self._items:
                obj, _ = self._items[model_id]
                self._items[model_id] = (obj, time.time())
                return obj
            if not is_installed(self.models_dir, model_id):
                raise ModelMissing(model_id)
            self._evict()
            import onnxruntime as ort
            opts = ort.SessionOptions()
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            opts.enable_mem_pattern = False  # нужно для DirectML и экономит пиковую память
            providers = list(self.providers)
            try:
                sess = ort.InferenceSession(str(model_path(self.models_dir, model_id)), opts, providers=providers)
            except Exception:
                sess = ort.InferenceSession(str(model_path(self.models_dir, model_id)), opts,
                                            providers=["CPUExecutionProvider"])
            self._items[model_id] = (sess, time.time())
            return sess

    def opencv_face(self, kind: str):
        """YuNet/SFace через OpenCV DNN — лёгкие, держим отдельно от тяжёлых."""
        import cv2
        key = "cv_" + kind
        with self._lock:
            if key in self._items:
                return self._items[key][0]
            mid = "yunet" if kind == "detector" else "sface"
            if not is_installed(self.models_dir, mid):
                raise ModelMissing(mid)
            p = str(model_path(self.models_dir, mid))
            if kind == "detector":
                obj = cv2.FaceDetectorYN.create(p, "", (320, 320), 0.7, 0.3, 50)
            else:
                obj = cv2.FaceRecognizerSF.create(p, "")
            self._items[key] = (obj, 0.0)
            return obj

    def _evict(self) -> None:
        heavy = [(k, t) for k, (_, t) in self._items.items() if not k.startswith("cv_")]
        while len(heavy) >= self.max_loaded:
            heavy.sort(key=lambda kv: kv[1])
            k, _ = heavy.pop(0)
            self._items.pop(k, None)
        gc.collect()

    def release(self) -> None:
        with self._lock:
            for k in [k for k in self._items if not k.startswith("cv_")]:
                self._items.pop(k, None)
        gc.collect()


def sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))
