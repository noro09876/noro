"""Задания, загрузка файлов, очередь и фоновый обработчик.

Один фоновый поток обрабатывает кадры строго по одному: так на 8 ГБ
видеопамяти и 16 ГБ ОЗУ не возникает пиков памяти. Состояние каждого кадра
записывается в базу после каждого шага, поэтому после перезапуска обработка
продолжается с первого незавершённого кадра.
"""
from __future__ import annotations

import gc
import html
import json
import os
import re
import shutil
import stat
import threading
import time
import traceback
import zipfile
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from . import imageio
from . import models as modelreg
from .comfy import ComfyClient
from .config import Settings
from .interpreter import TaskSpec, interpret, llm_assist
from .models import ModelCache
from .ops.base import Cancelled
from .pipeline import JobPaths, safe_process_frame
from .planner import build_plan
from .storage import (CANCELLED, DONE, DRAFT, FAILED, JOB_CANCELLED, JOB_DONE, JOB_RUNNING, PAUSED, PENDING,
                      QUEUED, REVIEW, RUNNING, Store)

REF_ROLES = {"background": "Фон / интерьер", "clothes": "Одежда (образец)", "style": "Стиль / референс",
             "layout": "Макет"}


class UserError(Exception):
    """Ошибка, которую нужно показать пользователю как есть."""


def safe_rel_path(name: str) -> str:
    """Очищает путь из загрузки/архива: без «..», абсолютных путей и запрещённых символов Windows."""
    parts = []
    for part in PurePosixPath(name.replace("\\", "/")).parts:
        if part in ("", ".", "..", "/") or part.endswith(":"):
            continue
        part = re.sub(r'[<>:"|?*\x00-\x1f]', "_", part).strip(" .")
        if part:
            parts.append(part[:120])
    return "/".join(parts) or "image"


def make_readonly(p: Path) -> None:
    try:
        os.chmod(p, stat.S_IREAD | stat.S_IRGRP | stat.S_IROTH)
    except OSError:
        pass


class JobManager:
    def __init__(self, settings: Settings, start_worker: bool = True):
        self.settings = settings
        self.store = Store(settings.db_path)
        self.cache = ModelCache(settings.models_dir, settings.onnx_providers or None)
        self.comfy = ComfyClient(settings.comfyui_url)
        self._wake = threading.Event()
        self._stop_frame = threading.Event()
        self._shutdown = threading.Event()
        self._current: dict = {}
        self._lock = threading.RLock()
        # Один кадр за раз: и пакетная обработка, и предпросмотр берут этот замок
        self._proc_lock = threading.Lock()
        recovered = self.store.recover_after_restart()
        if recovered:
            self.store.log("info", f"После перезапуска возвращено в очередь кадров: {recovered}")
        self._thread = None
        if start_worker:
            self._thread = threading.Thread(target=self._worker, name="photoagent-worker", daemon=True)
            self._thread.start()

    # ------------------------------------------------------------------ задания
    def paths(self, jid: str) -> JobPaths:
        return JobPaths(self.settings.jobs_dir / jid).ensure()

    def create_job(self, title: str = "") -> str:
        jid = self.store.create_job(title or time.strftime("Задание %d.%m.%Y %H:%M"))
        self.paths(jid)
        return jid

    def require_job(self, jid: str) -> dict:
        job = self.store.job(jid)
        if not job:
            raise UserError("Задание не найдено")
        return job

    def add_upload(self, jid: str, filename: str, stream: BinaryIO) -> list[str]:
        """Принимает фото или ZIP. Возвращает id добавленных кадров."""
        job = self.require_job(jid)
        if job["status"] not in (DRAFT, JOB_DONE, PAUSED, JOB_CANCELLED):
            raise UserError("Нельзя добавлять файлы во время обработки — поставьте задание на паузу")
        paths = self.paths(jid)
        rel = safe_rel_path(filename)
        if rel.lower().endswith(".zip"):
            tmp = paths.root / "upload.zip.partial"
            with open(tmp, "wb") as f:
                shutil.copyfileobj(stream, f, 1 << 20)
            try:
                return self._ingest_zip(jid, tmp, paths)
            finally:
                tmp.unlink(missing_ok=True)
        if not imageio.is_supported(rel):
            raise UserError(f"Формат файла не поддерживается: {filename}. Поддерживаются JPG, PNG, TIFF, WEBP, BMP и ZIP.")
        dest = self._unique(paths.originals / rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            shutil.copyfileobj(stream, f, 1 << 20)
        fid = self._register(jid, dest, paths)
        return [fid] if fid else []

    def _ingest_zip(self, jid: str, zpath: Path, paths: JobPaths) -> list[str]:
        ids = []
        try:
            zf = zipfile.ZipFile(zpath)
        except zipfile.BadZipFile:
            raise UserError("ZIP-архив повреждён") from None
        with zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name = info.filename
                try:
                    name = name.encode("cp437").decode("cp866") if not (info.flag_bits & 0x800) else name
                except (UnicodeEncodeError, UnicodeDecodeError):
                    pass
                rel = safe_rel_path(name)
                if "__MACOSX" in rel or Path(rel).name.startswith("._") or not imageio.is_supported(rel):
                    continue
                dest = self._unique(paths.originals / rel)
                dest.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(dest, "wb") as f:
                    shutil.copyfileobj(src, f, 1 << 20)
                fid = self._register(jid, dest, paths)
                if fid:
                    ids.append(fid)
        if not ids:
            raise UserError("В архиве не найдено фотографий поддерживаемых форматов")
        return ids

    def _register(self, jid: str, dest: Path, paths: JobPaths) -> str | None:
        try:
            w, h = imageio.read_size(dest)
        except Exception:  # noqa: BLE001
            dest.unlink(missing_ok=True)
            raise UserError(f"Файл {dest.name} не является корректным изображением") from None
        make_readonly(dest)
        rel = dest.relative_to(paths.originals).as_posix()
        return self.store.add_frame(jid, dest.name, rel, str(dest), w, h)

    @staticmethod
    def _unique(p: Path) -> Path:
        if not p.exists():
            return p
        i = 2
        while True:
            c = p.with_name(f"{p.stem}_{i}{p.suffix}")
            if not c.exists():
                return c
            i += 1

    def add_ref(self, jid: str, role: str, filename: str, stream: BinaryIO) -> str:
        self.require_job(jid)
        if role not in REF_ROLES:
            raise UserError("Неизвестный тип референса")
        rel = safe_rel_path(filename)
        if not imageio.is_supported(rel):
            raise UserError("Референс должен быть изображением (JPG, PNG, TIFF, WEBP)")
        paths = self.paths(jid)
        dest = self._unique(paths.refs / role / Path(rel).name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            shutil.copyfileobj(stream, f, 1 << 20)
        try:
            imageio.read_size(dest)
        except Exception:  # noqa: BLE001
            dest.unlink(missing_ok=True)
            raise UserError("Файл референса не открывается как изображение") from None
        return self.store.add_ref(jid, role, dest.name, str(dest))

    def refs_by_role(self, jid: str) -> dict[str, list[Path]]:
        out: dict[str, list[Path]] = {}
        for r in self.store.refs(jid):
            out.setdefault(r["role"], []).append(Path(r["path"]))
        return out

    def environment(self) -> dict:
        return {"models_dir": self.settings.models_dir, "comfyui": self.comfy.ready()}

    def set_task(self, jid: str, text: str, export: dict | None = None, use_llm: bool = False) -> dict:
        self.require_job(jid)
        spec = interpret(text)
        if use_llm and spec.unrecognized and self.settings.ollama_model:
            try:
                spec = llm_assist(spec, self.settings.ollama_url, self.settings.ollama_model)
            except Exception as e:  # noqa: BLE001
                spec.notes.append(f"Локальная языковая модель недоступна: {e}")
        if export:
            for k in ("format", "quality", "resolution", "bit_depth", "transparent"):
                if export.get(k) not in (None, "", "auto"):
                    spec.export[k] = export[k]
            if spec.export.get("resolution") == "long_side" and export.get("long_side"):
                spec.ops["resize"] = {"mode": "long_side", "long_side": int(export["long_side"])}
            if spec.export.get("format") == "jpeg" and spec.export.get("transparent"):
                spec.export["format"] = "png"
        plan = build_plan(spec, set(self.refs_by_role(jid)), self.environment())
        if "resize" in spec.ops and spec.ops["resize"].get("mode") == "long_side":
            for st in plan.steps:
                if st["op"] == "resize":
                    st["params"] = spec.ops["resize"]
        self.store.update_job(jid, task_text=text, spec=spec.to_dict(), plan=plan.to_dict(), export=spec.export)
        return {"spec": spec.to_dict(), "plan": plan.to_dict()}

    def replan(self, jid: str) -> dict:
        job = self.require_job(jid)
        spec = TaskSpec.from_dict(job["spec"] or {"text": job["task_text"]})
        plan = build_plan(spec, set(self.refs_by_role(jid)), self.environment())
        self.store.update_job(jid, plan=plan.to_dict())
        return plan.to_dict()

    # ------------------------------------------------------------------ управление очередью
    def start(self, jid: str) -> None:
        job = self.require_job(jid)
        if not self.store.frames(jid):
            raise UserError("Добавьте фотографии в задание")
        if not job["task_text"]:
            raise UserError("Опишите задание текстом")
        plan = self.replan(jid)
        if plan["errors"]:
            raise UserError("Нельзя запустить: " + " ".join(plan["errors"]))
        # Отменённые и упавшие кадры при новом запуске снова ставятся в очередь
        self.store.x("UPDATE frames SET status='pending', error='' WHERE job_id=? AND status IN ('cancelled','failed')", (jid,))
        self.store.update_job(jid, status=QUEUED, message="", started_at=job["started_at"] or time.time())
        self.store.log("info", "Задание поставлено в очередь", jid)
        self._wake.set()

    def pause(self, jid: str) -> None:
        job = self.require_job(jid)
        if job["status"] in (QUEUED, JOB_RUNNING):
            self.store.update_job(jid, status=PAUSED, message="Пауза: текущий кадр будет дообработан")
            self.store.log("info", "Пауза", jid)

    def resume(self, jid: str) -> None:
        job = self.require_job(jid)
        if job["status"] == PAUSED:
            self.store.update_job(jid, status=QUEUED, message="")
            self.store.log("info", "Продолжение", jid)
            self._wake.set()

    def cancel(self, jid: str) -> None:
        self.require_job(jid)
        self.store.update_job(jid, status=JOB_CANCELLED, message="Отменено", finished_at=time.time())
        self.store.x("UPDATE frames SET status='cancelled' WHERE job_id=? AND status='pending'", (jid,))
        with self._lock:
            if self._current.get("job_id") == jid:
                self._stop_frame.set()
        self.store.log("info", "Отменено пользователем", jid)

    def reprocess(self, jid: str, frame_ids: list[str], override_text: str | None = None) -> None:
        job = self.require_job(jid)
        for fid in frame_ids:
            fr = self.store.frame(fid)
            if not fr or fr["job_id"] != jid:
                raise UserError("Кадр не найден")
            if override_text:
                spec = interpret(override_text)
                plan = build_plan(spec, set(self.refs_by_role(jid)), self.environment())
                if plan.errors:
                    raise UserError("Нельзя запустить: " + " ".join(plan.errors))
            self.store.update_frame(fid, status=PENDING, error="", override_text=override_text or None,
                                    progress=0, step="")
        if job["status"] in (JOB_DONE, JOB_CANCELLED, DRAFT, PAUSED):
            self.store.update_job(jid, status=QUEUED, message="")
        self._wake.set()

    def approve(self, fid: str) -> None:
        fr = self.store.frame(fid)
        if not fr or fr["status"] != REVIEW or not fr["result_path"]:
            raise UserError("Кадр не ожидает проверки")
        paths = self.paths(fr["job_id"])
        src = Path(fr["result_path"])
        dest = paths.done / src.relative_to(paths.review)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), dest)
        self.store.update_frame(fid, status=DONE, result_path=str(dest))
        self.store.log("info", f"Кадр {fr['name']} одобрен вручную", fr["job_id"], fid)

    def delete_job(self, jid: str) -> None:
        job = self.require_job(jid)
        if job["status"] in (QUEUED, JOB_RUNNING):
            raise UserError("Сначала отмените или поставьте задание на паузу")
        root = self.settings.jobs_dir / jid
        for p in root.rglob("*"):
            try:
                os.chmod(p, stat.S_IWRITE | stat.S_IREAD)
            except OSError:
                pass
        shutil.rmtree(root, ignore_errors=True)
        self.store.delete_job(jid)

    # ------------------------------------------------------------------ результаты
    def write_zip(self, jid: str, dest: Path, include_review: bool = False) -> int:
        paths = self.paths(jid)
        n = 0
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_STORED) as zf:
            for fr in self.store.frames(jid):
                if fr["status"] == DONE or (include_review and fr["status"] == REVIEW):
                    p = Path(fr["result_path"] or "")
                    if p.exists():
                        base = paths.done if fr["status"] == DONE else paths.review
                        arc = ("" if fr["status"] == DONE else "на_проверку/") + p.relative_to(base).as_posix()
                        zf.write(p, arc)
                        n += 1
            rep = paths.reports / "report.html"
            if rep.exists():
                zf.write(rep, "отчёт.html")
        return n

    def write_report(self, jid: str) -> Path:
        job = self.require_job(jid)
        frames = self.store.frames(jid)
        counts = self.store.counts(jid)
        paths = self.paths(jid)
        data = {
            "job": {k: job[k] for k in ("id", "title", "task_text", "status", "created_at", "started_at", "finished_at")},
            "plan": job["plan"], "counts": counts,
            "frames": [{"name": f["rel_path"], "status": f["status"], "attempts": f["attempts"], "error": f["error"],
                        "issues": f["qc"].get("issues", []), "metrics": f["qc"].get("metrics", {}),
                        "warnings": f["qc"].get("warnings", [])} for f in frames],
        }
        (paths.reports / "report.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        status_ru = {"done": "готово", "review": "на проверку", "failed": "ошибка", "pending": "в очереди",
                     "running": "в работе", "cancelled": "отменено"}
        rows = []
        for f in frames:
            probs = "; ".join(i["message"] for i in f["qc"].get("issues", []) if i["severity"] != "info")
            rows.append(f"<tr><td>{html.escape(f['rel_path'])}</td><td>{status_ru.get(f['status'], f['status'])}</td>"
                        f"<td>{f['attempts']}</td><td>{html.escape(f['error'] or probs)}</td></tr>")
        steps = "".join(f"<li>{html.escape(s['title'])}</li>" for s in (job["plan"] or {}).get("steps", []))
        doc = f"""<!doctype html><html lang="ru"><meta charset="utf-8"><title>Отчёт PhotoAgent</title>
<style>body{{font-family:system-ui,sans-serif;margin:24px;color:#222}}table{{border-collapse:collapse;width:100%}}
td,th{{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:14px}}th{{background:#f4f4f4}}</style>
<h1>Отчёт: {html.escape(job['title'])}</h1>
<p><b>Задание:</b> {html.escape(job['task_text'])}</p>
<p><b>Шаги:</b></p><ol>{steps}</ol>
<p><b>Итого:</b> всего {counts['total']}, готово {counts['done']}, на проверку {counts['review']},
ошибок {counts['failed']}, отменено {counts['cancelled']}.</p>
<table><tr><th>Файл</th><th>Статус</th><th>Попыток</th><th>Проблемы</th></tr>{''.join(rows)}</table>
<p style="color:#777;font-size:12px">Автоматическая проверка не гарантирует художественное качество —
кадры «на проверку» просмотрите вручную.</p></html>"""
        out = paths.reports / "report.html"
        out.write_text(doc, encoding="utf-8")
        return out

    def status(self) -> dict:
        with self._lock:
            return dict(self._current)

    # ------------------------------------------------------------------ фоновый обработчик
    def shutdown(self) -> None:
        self._shutdown.set()
        self._stop_frame.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=10)

    def _next_frame(self) -> tuple[dict, dict] | None:
        for job in self.store.q("SELECT id FROM jobs WHERE status IN ('queued','running') ORDER BY created_at"):
            j = self.store.job(job["id"])
            pending = self.store.frames(j["id"], PENDING)
            if pending:
                return j, pending[0]
            # кадров не осталось — задание завершено
            self._finish_job(j["id"])
        return None

    def _finish_job(self, jid: str) -> None:
        counts = self.store.counts(jid)
        msg = f"Готово {counts['done']} из {counts['total']}"
        if counts["review"]:
            msg += f", на проверку {counts['review']}"
        if counts["failed"]:
            msg += f", ошибок {counts['failed']}"
        self.store.update_job(jid, status=JOB_DONE, message=msg, finished_at=time.time())
        self.store.log("info", "Задание завершено: " + msg, jid)
        try:
            self.write_report(jid)
        except Exception:  # noqa: BLE001
            self.store.log("error", "Не удалось записать отчёт: " + traceback.format_exc(limit=2), jid)
        self.cache.release()
        try:
            self.comfy.free()
        except Exception:  # noqa: BLE001
            pass

    def _worker(self) -> None:
        while not self._shutdown.is_set():
            try:
                nxt = self._next_frame()
            except Exception:  # noqa: BLE001
                self.store.log("error", "Сбой очереди: " + traceback.format_exc(limit=3))
                nxt = None
            if nxt is None:
                self._wake.wait(2.0)
                self._wake.clear()
                continue
            job, frame = nxt
            with self._proc_lock:
                self.run_frame(job, frame)

    def run_frame(self, job: dict, frame: dict) -> None:
        jid, fid = job["id"], frame["id"]
        self._stop_frame.clear()
        self.store.update_job(jid, status=JOB_RUNNING)
        self.store.update_frame(fid, status=RUNNING, attempts=frame["attempts"], progress=0, step="Загрузка")
        with self._lock:
            self._current = {"job_id": jid, "frame_id": fid, "name": frame["name"], "step": "Загрузка", "progress": 0}

        if frame.get("override_text"):
            spec = interpret(frame["override_text"])
            steps = build_plan(spec, set(self.refs_by_role(jid)), self.environment()).steps
            spec_d = spec.to_dict()
        else:
            spec_d = job["spec"]
            steps = job["plan"]["steps"]

        def progress(step: str, p: float) -> None:
            with self._lock:
                self._current.update(step=step, progress=p)
            self.store.update_frame(fid, step=step, progress=round(p, 3))

        def should_stop() -> bool:
            return self._stop_frame.is_set() or self._shutdown.is_set()

        comfy = self.comfy if self.comfy.ready() else None
        transient_left = self.settings.max_transient_retries
        while True:
            try:
                out = safe_process_frame(
                    settings=self.settings, cache=self.cache, comfy=comfy, original_path=Path(frame["original_path"]),
                    rel_path=frame["rel_path"], frame_id=fid, steps=steps, spec=spec_d, refs=self.refs_by_role(jid),
                    paths=self.paths(jid), should_stop=should_stop, on_progress=progress)
            except Cancelled:
                cur = self.store.job(jid)
                st = CANCELLED if cur and cur["status"] == JOB_CANCELLED else PENDING
                self.store.update_frame(fid, status=st, step="", progress=0)
                with self._lock:
                    self._current = {}
                return
            if out.status == "failed" and out.metrics.get("transient") and transient_left > 0:
                transient_left -= 1
                self.store.log("warn", f"{frame['name']}: временная ошибка, повтор ({out.error})", jid, fid)
                self.cache.release()
                try:
                    self.comfy.free()
                except Exception:  # noqa: BLE001
                    pass
                gc.collect()
                time.sleep(2)
                continue
            break

        qc_data = {"issues": out.issues, "metrics": out.metrics, "warnings": out.warnings}
        self.store.update_frame(
            fid, status={"done": DONE, "review": REVIEW}.get(out.status, FAILED),
            result_path=str(out.result_path) if out.result_path else None, qc=qc_data, log=out.log,
            error=out.error, attempts=frame["attempts"] + out.attempts, progress=1.0, step="")
        level = "info" if out.status == "done" else "warn" if out.status == "review" else "error"
        msg = {"done": "готово", "review": "на проверку", "failed": "ошибка"}[out.status if out.status in ("done", "review") else "failed"]
        detail = out.error or "; ".join(i["message"] for i in out.issues if i["severity"] != "info")
        self.store.log(level, f"{frame['name']}: {msg}" + (f" — {detail}" if detail else ""), jid, fid)
        with self._lock:
            self._current = {}
        cur = self.store.job(jid)
        if cur and cur["status"] == JOB_RUNNING:
            self.store.update_job(jid, status=QUEUED)

    def preview(self, jid: str, fid: str) -> dict:
        """Пробная обработка одного кадра без изменения его статуса (для проверки задания)."""
        job = self.require_job(jid)
        fr = self.store.frame(fid)
        if not fr or fr["job_id"] != jid:
            raise UserError("Кадр не найден")
        plan = self.replan(jid)
        if plan["errors"]:
            raise UserError("Нельзя запустить: " + " ".join(plan["errors"]))
        if not self._proc_lock.acquire(blocking=False):
            raise UserError("Идёт обработка другого кадра — предпросмотр будет доступен после паузы")
        with self._lock:
            self._current = {"job_id": jid, "frame_id": fid, "name": fr["name"], "step": "Предпросмотр", "progress": 0}
        try:
            paths = self.paths(jid)
            prev_paths = JobPaths(paths.root / "preview").ensure()
            out = safe_process_frame(
                settings=self.settings, cache=self.cache, comfy=self.comfy if self.comfy.ready() else None,
                original_path=Path(fr["original_path"]), rel_path=fr["rel_path"], frame_id=fid,
                steps=plan["steps"], spec=job["spec"], refs=self.refs_by_role(jid), paths=prev_paths,
                keep_intermediate=False, max_retries=0)
        finally:
            with self._lock:
                self._current = {}
            self._proc_lock.release()
        return {"status": out.status, "error": out.error, "issues": out.issues, "metrics": out.metrics,
                "warnings": out.warnings, "result_path": str(out.result_path) if out.result_path else None,
                "log": out.log}


def models_status(settings: Settings) -> list[dict]:
    st = modelreg.status(settings.models_dir)
    dl = modelreg.download_state()
    for m in st:
        if m["id"] in dl:
            m["download"] = dl[m["id"]]
    return st
