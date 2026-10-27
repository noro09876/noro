"""Чтение и запись изображений без потери качества.

Внутри системы кадр хранится как float32 RGB в диапазоне [0, 1] плюс
необязательный альфа-канал (float32 HxW). Так операции не теряют точность
между шагами, а 16-битные исходники не обрезаются до 8 бит.

При сохранении сохраняются ICC-профиль и EXIF (с исправленной ориентацией),
файл пишется во временный файл и затем атомарно переименовывается, чтобы
обрыв записи не оставил полуфайл.
"""
from __future__ import annotations

import io
import os
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 400_000_000  # большие сканы и панорамы — это нормально

SUPPORTED_INPUT = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".bmp"}
EXPORT_FORMATS = {"jpeg": ".jpg", "png": ".png", "tiff": ".tif", "webp": ".webp"}


@dataclass
class Photo:
    rgb: np.ndarray  # float32 HxWx3, [0, 1]
    alpha: np.ndarray | None = None  # float32 HxW, [0, 1]
    bit_depth: int = 8
    icc_profile: bytes | None = None
    exif: bytes | None = None
    source_format: str = ""
    meta: dict = field(default_factory=dict)

    @property
    def size(self) -> tuple[int, int]:
        h, w = self.rgb.shape[:2]
        return w, h

    def copy(self) -> "Photo":
        return Photo(
            rgb=self.rgb.copy(),
            alpha=None if self.alpha is None else self.alpha.copy(),
            bit_depth=self.bit_depth,
            icc_profile=self.icc_profile,
            exif=self.exif,
            source_format=self.source_format,
            meta=dict(self.meta),
        )


class ImageReadError(Exception):
    pass


def is_supported(path: str | os.PathLike) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_INPUT


def load(path: str | os.PathLike) -> Photo:
    path = Path(path)
    try:
        with Image.open(path) as im:
            im.load()
            fmt = (im.format or path.suffix.lstrip(".")).upper()
            icc = im.info.get("icc_profile")
            exif_obj = Image.Exif()
            if im.getexif():
                exif_obj.load(im.getexif().tobytes())
            orientation = exif_obj.get(0x0112, 1) if exif_obj else 1
            if exif_obj:
                exif_obj[0x0112] = 1  # пиксели будут повёрнуты, поэтому в файле-результате ориентация «как есть»
            exif = exif_obj.tobytes() if exif_obj else None
            mode = im.mode
            sixteen = mode.startswith("I;16") or mode in ("I", "RGB;16", "RGBA;16")
            if not sixteen:
                im = ImageOps.exif_transpose(im)
                has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
                im = im.convert("RGBA" if has_alpha else "RGB")
                arr = np.asarray(im, dtype=np.float32) / 255.0
                bit_depth = 8
    except Exception as e:  # noqa: BLE001 — нужно понятное сообщение для любого сбоя декодера
        raise ImageReadError(f"Не удалось открыть файл {path.name}: {e}") from e

    if sixteen or fmt in ("TIFF", "PNG"):
        # Pillow плохо держит 16-битные RGB; OpenCV читает их честно.
        raw = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_UNCHANGED)
        if raw is not None and raw.dtype == np.uint16:
            if raw.ndim == 2:
                raw = cv2.cvtColor(raw, cv2.COLOR_GRAY2BGR)
            if raw.shape[2] == 4:
                arr = cv2.cvtColor(raw, cv2.COLOR_BGRA2RGBA).astype(np.float32) / 65535.0
            else:
                arr = cv2.cvtColor(raw, cv2.COLOR_BGR2RGB).astype(np.float32) / 65535.0
            arr = _apply_orientation(arr, orientation)
            bit_depth = 16
        elif sixteen:
            raise ImageReadError(f"Не удалось прочитать 16-битный файл {path.name}")

    if arr.ndim != 3 or arr.shape[0] < 2 or arr.shape[1] < 2:
        raise ImageReadError(f"Файл {path.name} пустой или повреждён")
    alpha = None
    if arr.shape[2] == 4:
        alpha = np.ascontiguousarray(arr[:, :, 3])
        if float(alpha.min()) >= 0.999:
            alpha = None
        arr = arr[:, :, :3]
    return Photo(
        rgb=np.ascontiguousarray(arr, dtype=np.float32),
        alpha=alpha,
        bit_depth=bit_depth,
        icc_profile=icc,
        exif=exif,
        source_format=fmt,
    )


def _apply_orientation(arr: np.ndarray, orientation: int) -> np.ndarray:
    ops = {
        2: lambda a: a[:, ::-1],
        3: lambda a: a[::-1, ::-1],
        4: lambda a: a[::-1, :],
        5: lambda a: np.swapaxes(a, 0, 1),
        6: lambda a: np.swapaxes(a, 0, 1)[:, ::-1],
        7: lambda a: np.swapaxes(a, 0, 1)[::-1, ::-1],
        8: lambda a: np.swapaxes(a, 0, 1)[::-1, :],
    }
    f = ops.get(orientation)
    return np.ascontiguousarray(f(arr)) if f else arr


def read_size(path: str | os.PathLike) -> tuple[int, int]:
    """Размер с учётом EXIF-поворота, без декодирования всех пикселей."""
    with Image.open(path) as im:
        w, h = im.size
        o = im.getexif().get(0x0112, 1)
    return (h, w) if o in (5, 6, 7, 8) else (w, h)


def to_uint8(x: np.ndarray) -> np.ndarray:
    return (np.clip(x, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def to_uint16(x: np.ndarray) -> np.ndarray:
    return (np.clip(x, 0.0, 1.0) * 65535.0 + 0.5).astype(np.uint16)


def save(photo: Photo, path: str | os.PathLike, fmt: str = "png", quality: int = 95,
         keep_alpha: bool = True, bit_depth: int | None = None) -> Path:
    """Сохраняет кадр. Возвращает итоговый путь (расширение по формату)."""
    fmt = fmt.lower()
    if fmt == "jpg":
        fmt = "jpeg"
    if fmt not in EXPORT_FORMATS:
        raise ValueError(f"Неизвестный формат экспорта: {fmt}")
    path = Path(path).with_suffix(EXPORT_FORMATS[fmt])
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.stem + ".partial" + path.suffix)
    depth = bit_depth or photo.bit_depth
    alpha = photo.alpha if keep_alpha and fmt in ("png", "tiff", "webp") else None
    rgb = photo.rgb
    if alpha is None and photo.alpha is not None:
        # Формат без прозрачности: кладём на белый, а не на чёрный фон.
        a = photo.alpha[..., None]
        rgb = rgb * a + (1.0 - a)

    if depth == 16 and fmt in ("png", "tiff"):
        arr = to_uint16(rgb)
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        if alpha is not None:
            bgr = np.dstack([bgr, to_uint16(alpha)])
        ext = ".png" if fmt == "png" else ".tif"
        ok, buf = cv2.imencode(ext, bgr)
        if not ok:
            raise IOError(f"Не удалось закодировать {path.name}")
        buf.tofile(str(tmp))
        # OpenCV не пишет ICC — для 16 бит это допустимо, профиль sRGB по умолчанию
    else:
        arr = to_uint8(rgb)
        if alpha is not None:
            im = Image.fromarray(np.dstack([arr, to_uint8(alpha)]), "RGBA")
        else:
            im = Image.fromarray(arr, "RGB")
        kwargs: dict = {}
        if photo.icc_profile:
            kwargs["icc_profile"] = photo.icc_profile
        if photo.exif and fmt in ("jpeg", "webp", "tiff", "png"):
            kwargs["exif"] = photo.exif
        if fmt == "jpeg":
            kwargs.update(quality=quality, subsampling=0, optimize=True)
            im.save(tmp, "JPEG", **kwargs)
        elif fmt == "png":
            kwargs.update(compress_level=6)
            im.save(tmp, "PNG", **kwargs)
        elif fmt == "tiff":
            kwargs.update(compression="tiff_lzw")
            im.save(tmp, "TIFF", **kwargs)
        else:
            kwargs.update(quality=quality, method=6)
            if quality >= 100:
                kwargs["lossless"] = True
            im.save(tmp, "WEBP", **kwargs)
    os.replace(tmp, path)
    return path


def save_mask(mask: np.ndarray, path: str | os.PathLike) -> Path:
    path = Path(path).with_suffix(".png")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.stem + ".partial.png")
    Image.fromarray(to_uint8(mask), "L").save(tmp, "PNG")
    os.replace(tmp, path)
    return path


def load_mask(path: str | os.PathLike) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert("L"), dtype=np.float32) / 255.0


def preview_jpeg(photo: Photo, max_side: int = 1600, checker: bool = True) -> bytes:
    """Уменьшенная копия для интерфейса. Прозрачность показывается шахматкой."""
    rgb = photo.rgb
    h, w = rgb.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        size = (max(1, int(w * scale)), max(1, int(h * scale)))
        rgb = cv2.resize(rgb, size, interpolation=cv2.INTER_AREA)
        alpha = None if photo.alpha is None else cv2.resize(photo.alpha, size, interpolation=cv2.INTER_AREA)
    else:
        alpha = photo.alpha
    if alpha is not None:
        hh, ww = rgb.shape[:2]
        if checker:
            yy, xx = np.mgrid[0:hh, 0:ww]
            board = np.where(((yy // 16 + xx // 16) % 2) == 0, 0.92, 0.75).astype(np.float32)[..., None]
        else:
            board = np.ones((hh, ww, 1), np.float32)
        a = alpha[..., None]
        rgb = rgb * a + board * (1 - a)
    buf = io.BytesIO()
    Image.fromarray(to_uint8(rgb)).save(buf, "JPEG", quality=88)
    return buf.getvalue()
