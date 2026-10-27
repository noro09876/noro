"""Клиент локального ComfyUI — необязательного исполнителя тяжёлых ИИ-моделей.

PhotoAgent обращается только к ComfyUI на этом же компьютере (127.0.0.1).
ComfyUI берёт на себя загрузку моделей, выгрузку в оперативную память при
нехватке видеопамяти и поддержку RTX 50xx. Граф обработки собирается здесь
в коде; модели и узлы проверяются через /object_info перед запуском.

Модель редактирования по умолчанию — FLUX.2 [klein] 4B (Apache 2.0).
"""
from __future__ import annotations

import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass

import numpy as np
from PIL import Image

from .imageio import to_uint8


@dataclass
class EditModels:
    unet: str = "flux-2-klein-4b-fp8.safetensors"
    clip: str = "qwen_3_4b.safetensors"
    vae: str = "flux2-vae.safetensors"
    steps: int = 4
    cfg: float = 1.0


# Известные варианты файлов: берём первый, который есть в ComfyUI
UNET_CANDIDATES = [
    ("flux-2-klein-4b-fp8.safetensors", 4, 1.0),
    ("flux-2-klein-4b.safetensors", 4, 1.0),
    ("flux-2-klein-base-4b-fp8.safetensors", 20, 5.0),
    ("flux-2-klein-base-4b.safetensors", 20, 5.0),
]
CLIP_CANDIDATES = ["qwen_3_4b_fp8_mixed.safetensors", "qwen_3_4b.safetensors"]
VAE_CANDIDATES = ["flux2-vae.safetensors"]
UPSCALE_CANDIDATES = ["RealESRGAN_x4plus.pth", "4x-UltraSharp.pth", "RealESRGAN_x2plus.pth"]
REQUIRED_NODES = ["UNETLoader", "CLIPLoader", "VAELoader", "LoadImage", "CLIPTextEncode", "VAEEncode",
                  "ReferenceLatent", "EmptyFlux2LatentImage", "Flux2Scheduler", "KSamplerSelect", "RandomNoise",
                  "CFGGuider", "SamplerCustomAdvanced", "VAEDecode", "PreviewImage"]


class ComfyError(Exception):
    pass


class ComfyClient:
    def __init__(self, url: str, timeout: float = 1800.0):
        self.url = url.rstrip("/")
        self.timeout = timeout
        self._ready_at = 0.0
        self._ready = False
        self._info: dict | None = None
        self.client_id = uuid.uuid4().hex

    # --------------------------------------------------------------- HTTP
    def _get(self, path: str, timeout: float = 10.0) -> bytes:
        with urllib.request.urlopen(self.url + path, timeout=timeout) as r:
            return r.read()

    def _post_json(self, path: str, data: dict, timeout: float = 30.0) -> dict:
        req = urllib.request.Request(self.url + path, data=json.dumps(data).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:2000]
            raise ComfyError(f"ComfyUI отклонил запрос: {detail}") from e
        return json.loads(body) if body else {}

    def ready(self) -> bool:
        """Проверка доступности (кэшируется на 5 секунд)."""
        now = time.time()
        if now - self._ready_at < 5:
            return self._ready
        self._ready_at = now
        try:
            self._get("/system_stats", timeout=1.5)
            self._ready = True
        except Exception:  # noqa: BLE001
            self._ready = False
            self._info = None
        return self._ready

    def system_stats(self) -> dict:
        return json.loads(self._get("/system_stats"))

    def object_info(self, refresh: bool = False) -> dict:
        if self._info is None or refresh:
            self._info = json.loads(self._get("/object_info", timeout=60))
        return self._info

    def _choices(self, node: str, field: str) -> list[str]:
        info = self.object_info()
        try:
            spec = info[node]["input"]["required"][field]
        except KeyError:
            return []
        first = spec[0]
        if isinstance(first, list):
            return list(first)
        if isinstance(first, str) and first == "COMBO" and len(spec) > 1:
            return list(spec[1].get("options", []))
        return []

    def capabilities(self) -> dict:
        """Что можно делать через ComfyUI прямо сейчас и чего не хватает."""
        if not self.ready():
            return {"available": False, "reason": "ComfyUI не запущен по адресу " + self.url}
        info = self.object_info(refresh=True)
        missing_nodes = [n for n in REQUIRED_NODES if n not in info]
        unets = self._choices("UNETLoader", "unet_name")
        clips = self._choices("CLIPLoader", "clip_name")
        vaes = self._choices("VAELoader", "vae_name")
        ups = self._choices("UpscaleModelLoader", "model_name")
        edit = self.pick_edit_models(unets, clips, vaes)
        res = {"available": True, "missing_nodes": missing_nodes, "edit_models": edit.__dict__ if edit else None,
               "upscale_model": next((u for u in UPSCALE_CANDIDATES if u in ups), None)}
        try:
            st = self.system_stats()
            dev = (st.get("devices") or [{}])[0]
            res["device"] = dev.get("name")
            res["vram_total_gb"] = round(dev.get("vram_total", 0) / 2 ** 30, 1)
        except Exception:  # noqa: BLE001
            pass
        missing = []
        if not edit:
            if not any(u for u, _, _ in UNET_CANDIDATES if u in unets):
                missing.append("модель FLUX.2 klein 4B (папка models/diffusion_models)")
            if not any(c in clips for c in CLIP_CANDIDATES):
                missing.append("текстовый кодировщик qwen_3_4b (папка models/text_encoders)")
            if not any(v in vaes for v in VAE_CANDIDATES):
                missing.append("flux2-vae (папка models/vae)")
        res["missing_models"] = missing
        res["can_edit"] = bool(edit) and not missing_nodes
        return res

    @staticmethod
    def pick_edit_models(unets: list[str], clips: list[str], vaes: list[str]) -> EditModels | None:
        u = next(((n, s, c) for n, s, c in UNET_CANDIDATES if n in unets), None)
        cl = next((c for c in CLIP_CANDIDATES if c in clips), None)
        v = next((x for x in VAE_CANDIDATES if x in vaes), None)
        if not (u and cl and v):
            return None
        return EditModels(unet=u[0], clip=cl, vae=v, steps=u[1], cfg=u[2])

    def free(self) -> None:
        if self.ready():
            self._post_json("/free", {"unload_models": True, "free_memory": True})

    # --------------------------------------------------------------- изображения
    def upload(self, rgb: np.ndarray, name: str) -> str:
        buf = io.BytesIO()
        Image.fromarray(to_uint8(rgb)).save(buf, "PNG")
        boundary = uuid.uuid4().hex
        body = b"".join([
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\n"
            f"Content-Type: image/png\r\n\r\n".encode(), buf.getvalue(), b"\r\n",
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"subfolder\"\r\n\r\nphotoagent_tmp\r\n".encode(),
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n".encode(),
            f"--{boundary}--\r\n".encode(),
        ])
        req = urllib.request.Request(self.url + "/upload/image", data=body,
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.loads(r.read())
        sub = res.get("subfolder") or ""
        return f"{sub}/{res['name']}" if sub else res["name"]

    def run(self, graph: dict, output_node: str) -> np.ndarray:
        res = self._post_json("/prompt", {"prompt": graph, "client_id": self.client_id})
        if res.get("node_errors"):
            raise ComfyError("Ошибка графа ComfyUI: " + json.dumps(res["node_errors"], ensure_ascii=False)[:1500])
        pid = res["prompt_id"]
        t0 = time.time()
        while True:
            if time.time() - t0 > self.timeout:
                try:
                    self._post_json("/interrupt", {})
                except Exception:  # noqa: BLE001
                    pass
                raise ComfyError("ComfyUI не успел обработать кадр (превышено время ожидания)")
            hist = json.loads(self._get(f"/history/{pid}", timeout=30))
            if pid in hist:
                entry = hist[pid]
                status = entry.get("status", {})
                if status.get("status_str") == "error":
                    msgs = [m for m in status.get("messages", []) if m and m[0] == "execution_error"]
                    detail = msgs[0][1].get("exception_message", "") if msgs else ""
                    raise ComfyError("ComfyUI завершился с ошибкой: " + detail[:800])
                outs = entry.get("outputs", {}).get(output_node, {}).get("images", [])
                if outs:
                    im = outs[0]
                    q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""),
                                                "type": im.get("type", "temp")})
                    data = self._get("/view?" + q, timeout=120)
                    with Image.open(io.BytesIO(data)) as pil:
                        return np.asarray(pil.convert("RGB"), dtype=np.float32) / 255.0
                if status.get("completed"):
                    raise ComfyError("ComfyUI не вернул изображение")
            time.sleep(1.0)

    # --------------------------------------------------------------- графы
    def edit(self, rgb: np.ndarray, prompt: str, seed: int = 0, reference: np.ndarray | None = None,
             models: EditModels | None = None, negative: str = "") -> np.ndarray:
        """Редактирование изображения по тексту (FLUX.2 klein). Размер rgb должен быть кратен 16."""
        h, w = rgb.shape[:2]
        if h % 16 or w % 16:
            raise ValueError("Размер для модели редактирования должен быть кратен 16")
        if models is None:
            caps = self.capabilities()
            if not caps.get("can_edit"):
                raise ComfyError("В ComfyUI нет модели редактирования: " + ", ".join(caps.get("missing_models") or
                                                                                    caps.get("missing_nodes") or []))
            models = EditModels(**caps["edit_models"])
        name = self.upload(rgb, f"pa_{uuid.uuid4().hex[:10]}.png")
        g: dict = {
            "1": {"class_type": "UNETLoader", "inputs": {"unet_name": models.unet, "weight_dtype": "default"}},
            "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": models.clip, "type": "flux2", "device": "default"}},
            "3": {"class_type": "VAELoader", "inputs": {"vae_name": models.vae}},
            "4": {"class_type": "LoadImage", "inputs": {"image": name}},
            "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": prompt}},
            "8": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": negative}},
            "9": {"class_type": "VAEEncode", "inputs": {"pixels": ["4", 0], "vae": ["3", 0]}},
            "10": {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["7", 0], "latent": ["9", 0]}},
            "11": {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["8", 0], "latent": ["9", 0]}},
            "12": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
            "13": {"class_type": "Flux2Scheduler", "inputs": {"steps": models.steps, "width": w, "height": h}},
            "14": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
            "15": {"class_type": "RandomNoise", "inputs": {"noise_seed": int(seed)}},
            "16": {"class_type": "CFGGuider", "inputs": {"model": ["1", 0], "positive": ["10", 0],
                                                         "negative": ["11", 0], "cfg": models.cfg}},
            "17": {"class_type": "SamplerCustomAdvanced", "inputs": {
                "noise": ["15", 0], "guider": ["16", 0], "sampler": ["14", 0], "sigmas": ["13", 0],
                "latent_image": ["12", 0]}},
            "18": {"class_type": "VAEDecode", "inputs": {"samples": ["17", 0], "vae": ["3", 0]}},
            "19": {"class_type": "PreviewImage", "inputs": {"images": ["18", 0]}},
        }
        if reference is not None:
            rname = self.upload(reference, f"pa_ref_{uuid.uuid4().hex[:10]}.png")
            g["20"] = {"class_type": "LoadImage", "inputs": {"image": rname}}
            g["21"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["20", 0], "vae": ["3", 0]}}
            g["22"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["10", 0], "latent": ["21", 0]}}
            g["23"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["11", 0], "latent": ["21", 0]}}
            g["16"]["inputs"]["positive"] = ["22", 0]
            g["16"]["inputs"]["negative"] = ["23", 0]
        out = self.run(g, "19")
        if out.shape[:2] != (h, w):
            from cv2 import INTER_CUBIC, resize
            out = resize(out, (w, h), interpolation=INTER_CUBIC)
        return out

    def upscale(self, rgb: np.ndarray, factor: float) -> np.ndarray:
        caps = self.capabilities()
        model = caps.get("upscale_model")
        if not model:
            raise ComfyError("в ComfyUI нет модели увеличения (RealESRGAN_x4plus.pth в models/upscale_models)")
        name = self.upload(rgb, f"pa_up_{uuid.uuid4().hex[:10]}.png")
        g = {
            "1": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": model}},
            "2": {"class_type": "LoadImage", "inputs": {"image": name}},
            "3": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["1", 0], "image": ["2", 0]}},
            "4": {"class_type": "PreviewImage", "inputs": {"images": ["3", 0]}},
        }
        return self.run(g, "4")
