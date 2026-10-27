"""Локальный веб-сервер PhotoAgent (FastAPI). Слушает только 127.0.0.1."""
from __future__ import annotations

import os
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask

from . import __version__, imageio
from . import models as modelreg
from .config import Settings, load_settings
from .jobs import REF_ROLES, JobManager, UserError, models_status
from .ops import OPERATIONS

WEB = Path(__file__).resolve().parent / "web"


def create_app(settings: Settings | None = None, start_worker: bool = True) -> FastAPI:
    settings = settings or load_settings()
    mgr = JobManager(settings, start_worker=start_worker)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        mgr.shutdown()

    app = FastAPI(title="PhotoAgent", version=__version__, lifespan=lifespan)
    app.state.mgr = mgr

    @app.exception_handler(UserError)
    async def user_error(_: Request, exc: UserError):
        return JSONResponse({"error": str(exc)}, status_code=400)

    app.mount("/static", StaticFiles(directory=WEB), name="static")

    @app.get("/", response_class=HTMLResponse)
    def index() -> HTMLResponse:
        return HTMLResponse((WEB / "index.html").read_text(encoding="utf-8"))

    # ------------------------------------------------------------- система
    @app.get("/api/system")
    def system() -> dict:
        import onnxruntime as ort
        comfy = mgr.comfy.capabilities() if mgr.comfy.ready() else {"available": False,
                                                                    "reason": "ComfyUI не запущен (" + settings.comfyui_url + ")"}
        return {
            "version": __version__,
            "data_dir": str(settings.data_dir),
            "models_dir": str(settings.models_dir),
            "onnx_providers": mgr.cache.providers,
            "onnx_available": ort.get_available_providers(),
            "comfyui": comfy,
            "ollama_model": settings.ollama_model or None,
            "operations": [{"id": k, "title": v.title, "needs_comfyui": v.needs_comfyui} for k, v in OPERATIONS.items()],
            "current": mgr.status(),
        }

    @app.get("/api/models")
    def models() -> list[dict]:
        return models_status(settings)

    @app.post("/api/models/{model_id}/download")
    def download_model(model_id: str) -> dict:
        if model_id not in modelreg.MODELS:
            raise HTTPException(404, "Неизвестная модель")
        st = modelreg.download_state().get(model_id)
        if st and st.get("status") == "downloading":
            return {"status": "downloading"}

        def run() -> None:
            try:
                modelreg.download(settings.models_dir, model_id)
            except Exception:  # noqa: BLE001 — состояние ошибки сохраняется в download_state
                pass
        threading.Thread(target=run, daemon=True).start()
        return {"status": "started"}

    # ------------------------------------------------------------- задания
    @app.get("/api/jobs")
    def jobs() -> list[dict]:
        return mgr.store.jobs()

    @app.post("/api/jobs")
    def create_job(title: str = Form("")) -> dict:
        return {"id": mgr.create_job(title)}

    @app.get("/api/jobs/{jid}")
    def job(jid: str) -> dict:
        j = mgr.require_job(jid)
        frames = mgr.store.frames(jid)
        for f in frames:
            f.pop("log", None)
        return {"job": j, "frames": frames, "counts": mgr.store.counts(jid), "refs": mgr.store.refs(jid),
                "current": mgr.status() if mgr.status().get("job_id") == jid else None}

    @app.delete("/api/jobs/{jid}")
    def delete_job(jid: str) -> dict:
        mgr.delete_job(jid)
        return {"ok": True}

    @app.post("/api/jobs/{jid}/files")
    def upload(jid: str, files: list[UploadFile] = File(...)) -> dict:
        added, errors = [], []
        for f in files:
            try:
                added += mgr.add_upload(jid, f.filename or "image", f.file)
            except UserError as e:
                errors.append(str(e))
        return {"added": len(added), "errors": errors}

    @app.post("/api/jobs/{jid}/refs")
    def upload_ref(jid: str, role: str = Form(...), file: UploadFile = File(...)) -> dict:
        return {"id": mgr.add_ref(jid, role, file.filename or "ref.png", file.file)}

    @app.delete("/api/jobs/{jid}/refs/{rid}")
    def delete_ref(jid: str, rid: str) -> dict:
        r = mgr.store.delete_ref(rid)
        if r:
            Path(r["path"]).unlink(missing_ok=True)
        mgr.replan(jid)
        return {"ok": True}

    @app.get("/api/refs/{rid}/image")
    def ref_image(rid: str) -> Response:
        rows = mgr.store.q("SELECT * FROM refs WHERE id=?", (rid,))
        if not rows:
            raise HTTPException(404)
        return Response(_preview(Path(rows[0]["path"]), 600), media_type="image/jpeg")

    @app.get("/api/ref-roles")
    def ref_roles() -> dict:
        return REF_ROLES

    @app.post("/api/jobs/{jid}/task")
    def set_task(jid: str, payload: dict) -> dict:
        return mgr.set_task(jid, payload.get("text", ""), payload.get("export") or {}, bool(payload.get("use_llm")))

    @app.post("/api/jobs/{jid}/rename")
    def rename(jid: str, payload: dict) -> dict:
        mgr.require_job(jid)
        mgr.store.update_job(jid, title=str(payload.get("title", ""))[:200])
        return {"ok": True}

    @app.post("/api/jobs/{jid}/{action}")
    def control(jid: str, action: str, payload: dict | None = None) -> dict:
        payload = payload or {}
        if action == "start":
            mgr.start(jid)
        elif action == "pause":
            mgr.pause(jid)
        elif action == "resume":
            mgr.resume(jid)
        elif action == "cancel":
            mgr.cancel(jid)
        elif action == "reprocess":
            mgr.reprocess(jid, list(payload.get("frames") or []), payload.get("text") or None)
        elif action == "preview":
            return mgr.preview(jid, payload["frame"])
        else:
            raise HTTPException(404)
        return {"ok": True}

    @app.post("/api/frames/{fid}/approve")
    def approve(fid: str) -> dict:
        mgr.approve(fid)
        return {"ok": True}

    @app.get("/api/frames/{fid}")
    def frame(fid: str) -> dict:
        fr = mgr.store.frame(fid)
        if not fr:
            raise HTTPException(404)
        return fr

    @app.get("/api/frames/{fid}/image/{kind}")
    def frame_image(fid: str, kind: str, size: int = 1600) -> Response:
        fr = mgr.store.frame(fid)
        if not fr:
            raise HTTPException(404)
        size = max(64, min(size, 4096))
        if kind == "original":
            p = Path(fr["original_path"])
        elif kind == "result":
            if not fr["result_path"]:
                raise HTTPException(404, "Результата пока нет")
            p = Path(fr["result_path"])
        elif kind == "preview":
            prev_root = mgr.paths(fr["job_id"]).root / "preview"
            stem = Path(fr["rel_path"]).with_suffix("").as_posix()
            cands = [c for sub in ("done", "review") for c in (prev_root / sub).glob(stem + ".*") if c.is_file()]
            if not cands:
                raise HTTPException(404, "Предпросмотра нет")
            p = max(cands, key=lambda c: c.stat().st_mtime)
        else:
            raise HTTPException(404)
        if not p.exists():
            raise HTTPException(404, "Файл не найден")
        return Response(_preview(p, size), media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.get("/api/frames/{fid}/download")
    def frame_download(fid: str) -> FileResponse:
        fr = mgr.store.frame(fid)
        if not fr or not fr["result_path"]:
            raise HTTPException(404)
        p = Path(fr["result_path"])
        return FileResponse(p, filename=p.name)

    @app.get("/api/review")
    def review() -> list[dict]:
        out = mgr.store.frames_for_review()
        for f in out:
            f.pop("log", None)
        return out

    @app.get("/api/jobs/{jid}/events")
    def events(jid: str) -> list[dict]:
        return mgr.store.events(jid)

    @app.get("/api/jobs/{jid}/report")
    def report(jid: str) -> FileResponse:
        p = mgr.write_report(jid)
        return FileResponse(p, media_type="text/html; charset=utf-8")

    @app.get("/api/jobs/{jid}/zip")
    def download_zip(jid: str, include_review: bool = False) -> FileResponse:
        job = mgr.require_job(jid)
        mgr.write_report(jid)
        fd, tmp = tempfile.mkstemp(suffix=".zip", dir=settings.data_dir)
        os.close(fd)
        n = mgr.write_zip(jid, Path(tmp), include_review)
        if n == 0:
            os.unlink(tmp)
            raise UserError("Готовых фотографий пока нет")
        name = "".join(c if c.isalnum() or c in " _-." else "_" for c in job["title"]).strip() or jid
        return FileResponse(tmp, filename=f"{name}.zip", media_type="application/zip",
                            background=BackgroundTask(lambda: os.unlink(tmp)))

    return app


def _preview(path: Path, size: int) -> bytes:
    cache = path.parent / ".previews" / f"{path.name}.{size}.jpg"
    try:
        if cache.exists() and cache.stat().st_mtime >= path.stat().st_mtime:
            return cache.read_bytes()
    except OSError:
        pass
    data = imageio.preview_jpeg(imageio.load(path), size)
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(data)
    except OSError:
        pass
    return data
