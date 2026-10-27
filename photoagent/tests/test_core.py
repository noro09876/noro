import io
import zipfile

import cv2
import numpy as np
import pytest
from PIL import Image

from photoagent import imageio, imgutil, qc
from photoagent.interpreter import interpret
from photoagent.jobs import safe_rel_path
from photoagent.models import ModelCache
from photoagent.ops import FrameContext, get
from photoagent.ops.background import chroma_alpha, detect_screen
from photoagent.planner import build_plan

from conftest import green_screen, synthetic_subject


def ctx_for(settings, rgb, alpha=None, spec=None):
    p = imageio.Photo(rgb=rgb.astype(np.float32), alpha=alpha)
    return FrameContext(original=p.copy(), photo=p.copy(), settings=settings,
                        cache=ModelCache(settings.models_dir), spec=spec or {})


# ---------------------------------------------------------------- чтение/запись

def test_roundtrip_jpeg_keeps_size_and_exif_orientation(tmp_path):
    arr = np.zeros((40, 80, 3), np.uint8)
    arr[:, :40] = 255  # левая половина белая
    im = Image.fromarray(arr)
    exif = im.getexif()
    exif[0x0112] = 6  # повёрнуто на 90°
    im.save(tmp_path / "a.jpg", exif=exif.tobytes(), quality=95)
    p = imageio.load(tmp_path / "a.jpg")
    assert p.size == (40, 80)  # ширина и высота поменялись местами
    assert imageio.read_size(tmp_path / "a.jpg") == (40, 80)
    out = imageio.save(p, tmp_path / "b", "jpeg")
    q = imageio.load(out)
    assert q.size == (40, 80)
    assert Image.open(out).getexif().get(0x0112, 1) == 1  # ориентация сброшена — пиксели уже повёрнуты


def test_16bit_png_roundtrip(tmp_path):
    arr = (np.linspace(0, 65535, 64 * 32 * 3).reshape(64, 32, 3)).astype(np.uint16)
    cv2.imwrite(str(tmp_path / "x.png"), arr)
    p = imageio.load(tmp_path / "x.png")
    assert p.bit_depth == 16
    out = imageio.save(p, tmp_path / "y", "png")
    back = cv2.imread(str(out), cv2.IMREAD_UNCHANGED)
    assert back.dtype == np.uint16
    assert np.abs(back.astype(int) - arr.astype(int)).max() <= 1


def test_alpha_saved_in_png_and_flattened_in_jpeg(tmp_path):
    rgb = np.full((20, 20, 3), 0.2, np.float32)
    a = np.zeros((20, 20), np.float32)
    a[5:15, 5:15] = 1
    p = imageio.Photo(rgb=rgb, alpha=a)
    png = imageio.load(imageio.save(p, tmp_path / "t", "png"))
    assert png.alpha is not None and png.alpha[0, 0] == 0
    jpg = imageio.load(imageio.save(p, tmp_path / "t", "jpeg"))
    assert jpg.alpha is None and jpg.rgb[0, 0].mean() > 0.95  # прозрачное стало белым


def test_corrupt_file_reports_error(tmp_path):
    (tmp_path / "bad.jpg").write_bytes(b"not an image")
    with pytest.raises(imageio.ImageReadError):
        imageio.load(tmp_path / "bad.jpg")


# ---------------------------------------------------------------- фон

def test_chroma_key_recovers_alpha():
    F, alpha = synthetic_subject()
    img = green_screen(F, alpha)
    assert detect_screen(img)[0] == "green"
    est, _ = chroma_alpha(img, "green")
    err = np.abs(est - alpha)
    assert err.mean() < 0.02
    edge = (alpha > 0.05) & (alpha < 0.95)
    assert err[edge].mean() < 0.2


def test_remove_background_without_models_and_despill(settings):
    F, alpha = synthetic_subject()
    img = green_screen(F, alpha, spill=0.1)
    ctx = ctx_for(settings, img)
    get("remove_background").run(ctx, {"ai_assist": True})
    assert ctx.photo.alpha is not None
    assert any("BiRefNet" in w for w in ctx.warnings)  # модель не скачана — честное предупреждение
    edge = (ctx.photo.alpha > 0.1) & (ctx.photo.alpha < 0.9)
    rgb = ctx.photo.rgb
    excess = np.maximum(rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2]), 0)
    excess_in = np.maximum(img[..., 1] - np.maximum(img[..., 0], img[..., 2]), 0)
    assert excess[edge].mean() < 0.3 * excess_in[edge].mean()  # зелёный ореол подавлен


def test_no_screen_without_model_gives_clear_error(settings):
    rng = np.random.default_rng(0)
    img = rng.uniform(0, 1, (100, 100, 3)).astype(np.float32)
    ctx = ctx_for(settings, img)
    from photoagent.ops.base import OperationError
    with pytest.raises(OperationError, match="Модели"):
        get("remove_background").run(ctx, {})


def test_replace_background_keeps_size_and_composites(settings, tmp_path):
    F, alpha = synthetic_subject()
    bg = np.zeros((300, 900, 3), np.float32)
    bg[..., 2] = 0.6
    imageio.save(imageio.Photo(rgb=bg), tmp_path / "bg", "png")
    ctx = ctx_for(settings, F, alpha)
    ctx.masks["subject"] = alpha
    ctx.refs = {"background": [tmp_path / "bg.png"]}
    get("replace_background").run(ctx, {"harmonize": 0.5})
    assert ctx.photo.rgb.shape == F.shape
    assert ctx.photo.alpha is None
    assert ctx.photo.rgb[0, 0, 2] > 0.4  # угол — новый фон


# ---------------------------------------------------------------- цвет и улучшение

def test_white_balance_removes_cast(settings):
    rng = np.random.default_rng(1)
    base = rng.uniform(0.2, 0.8, (200, 200, 1)).repeat(3, -1).astype(np.float32)  # нейтральная сцена
    cast = imgutil.linear_to_srgb(imgutil.srgb_to_linear(base) * np.array([1.2, 1.0, 0.8], np.float32))
    ctx = ctx_for(settings, cast)
    get("white_balance").run(ctx, {"strength": 1.0})
    m = ctx.photo.rgb.reshape(-1, 3).mean(0)
    m0 = cast.reshape(-1, 3).mean(0)
    assert abs(m[0] - m[2]) < 0.3 * abs(m0[0] - m0[2])


def test_exposure_brightens_dark_image(settings):
    dark = np.full((100, 100, 3), 0.15, np.float32) + np.random.default_rng(2).uniform(0, 0.1, (100, 100, 3)).astype(np.float32)
    ctx = ctx_for(settings, dark)
    get("exposure_contrast").run(ctx, {})
    assert ctx.photo.rgb.mean() > dark.mean() + 0.05
    assert ctx.photo.rgb.max() <= 1.0


def test_denoise_reduces_noise(settings):
    clean = np.full((128, 128, 3), 0.5, np.float32)
    noisy = np.clip(clean + np.random.default_rng(3).normal(0, 0.05, clean.shape), 0, 1).astype(np.float32)
    ctx = ctx_for(settings, noisy)
    get("denoise").run(ctx, {})
    assert np.abs(ctx.photo.rgb - clean).mean() < 0.6 * np.abs(noisy - clean).mean()


def test_upscale_and_resize_back(settings):
    img = np.random.default_rng(4).uniform(0, 1, (50, 80, 3)).astype(np.float32)
    ctx = ctx_for(settings, img)
    get("upscale").run(ctx, {"factor": 2})
    assert ctx.photo.rgb.shape[:2] == (100, 160)
    get("resize").run(ctx, {"mode": "original"})
    assert ctx.photo.rgb.shape[:2] == (50, 80)


# ---------------------------------------------------------------- задание и план

def test_interpret_user_example():
    s = interpret("Удали зелёный фон, аккуратно обработай волосы, переодень ребёнка в чёрную выпускную мантию, "
                  "сохрани его лицо, причёску, позу и положение рук, помести его в предоставленный интерьер, "
                  "согласуй освещение и цвета. Сохрани фотографии в исходном разрешении.")
    assert s.ops["remove_background"]["screen"] == "green"
    assert "black" in s.ops["change_clothes"]["prompt"] and "gown" in s.ops["change_clothes"]["prompt"]
    assert s.ops["replace_background"]["harmonize"] > 0.5
    assert s.export["resolution"] == "original"
    assert all(s.preserve.values())
    assert not s.unrecognized


@pytest.mark.parametrize("text,op", [
    ("Убери шум", "denoise"), ("сделай светлее", "exposure_contrast"), ("исправь баланс белого", "white_balance"),
    ("убери прыщики", "blemishes"), ("увеличь разрешение в 2 раза", "upscale"), ("повысь резкость", "sharpen"),
    ("сделай белый фон", "replace_background"), ("вырежи человека", "remove_background"),
])
def test_interpret_simple(text, op):
    assert op in interpret(text).ops


def test_interpret_reports_unknown():
    s = interpret("Нарисуй дракона на заднем плане")
    assert s.unrecognized


def test_plan_order_and_missing_refs(settings):
    s = interpret("Удали зелёный фон и помести в интерьер, переодень в чёрный костюм")
    plan = build_plan(s, set(), {"models_dir": settings.models_dir, "comfyui": False})
    ops = [st["op"] for st in plan.steps]
    assert ops.index("remove_background") < ops.index("replace_background") < ops.index("change_clothes")
    assert any("фон" in e for e in plan.errors)
    assert any("ComfyUI" in e for e in plan.errors)


def test_plan_empty_task(settings):
    plan = build_plan(interpret("привет"), set(), {"models_dir": settings.models_dir, "comfyui": False})
    assert plan.errors


# ---------------------------------------------------------------- проверка качества

def test_qc_detects_halo(settings):
    F, alpha = synthetic_subject()
    ctx = ctx_for(settings, F.copy(), alpha)
    ctx.masks["subject"] = alpha
    ctx.info["screen"] = "green"
    ring = cv2.morphologyEx((alpha > 0.5).astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((7, 7), np.uint8)) > 0
    ctx.photo.rgb[ring, 1] = 0.9  # явный зелёный контур
    issues = qc.check_halo(ctx)
    assert issues and issues[0].code == "color_halo" and issues[0].fix


def test_qc_file_checks(tmp_path):
    p = imageio.Photo(rgb=np.full((10, 10, 3), 0.5, np.float32))
    path = imageio.save(p, tmp_path / "flat", "png")
    codes = {i.code for i in qc.check_file(path, (10, 10), True)}
    assert {"alpha_missing", "empty_image"} <= codes
    codes = {i.code for i in qc.check_file(path, (20, 10), False)}
    assert "size_mismatch" in codes


# ---------------------------------------------------------------- файлы

def test_safe_rel_path():
    assert safe_rel_path("../../etc/passwd") == "etc/passwd"
    assert safe_rel_path("C:\\Users\\a\\photo:1.jpg") == "Users/a/photo_1.jpg"
    assert safe_rel_path("папка/фото 1.JPG") == "папка/фото 1.JPG"


def make_zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()


def jpeg_bytes(rgb: np.ndarray) -> bytes:
    b = io.BytesIO()
    Image.fromarray(imageio.to_uint8(rgb)).save(b, "JPEG", quality=95)
    return b.getvalue()
