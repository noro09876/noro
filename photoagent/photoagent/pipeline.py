"""Обработка одного кадра: шаги плана → сохранение → контроль качества → исправление.

Повторы ограничены: после max_quality_retries попыток кадр с оставшимися
серьёзными проблемами помечается «на проверку». Из всех попыток сохраняется
лучшая (с наименьшим штрафом контроля качества).
"""
from __future__ import annotations

import gc
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import imageio, qc
from .config import Settings
from .models import ModelCache
from .ops import FrameContext, get
from .ops.base import Cancelled, OperationError


@dataclass
class JobPaths:
    root: Path

    @property
    def originals(self) -> Path: return self.root / "originals"
    @property
    def refs(self) -> Path: return self.root / "refs"
    @property
    def work(self) -> Path: return self.root / "work"
    @property
    def done(self) -> Path: return self.root / "done"
    @property
    def review(self) -> Path: return self.root / "review"
    @property
    def reports(self) -> Path: return self.root / "reports"

    def ensure(self) -> "JobPaths":
        for p in (self.originals, self.refs, self.work, self.done, self.review, self.reports):
            p.mkdir(parents=True, exist_ok=True)
        return self


@dataclass
class FrameOutcome:
    status: str  # done | review | failed
    result_path: Path | None = None
    issues: list[dict] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    log: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    attempts: int = 0
    error: str = ""


def output_name(rel_path: str, fmt: str) -> Path:
    """Сохраняем структуру папок исходников, меняем только расширение."""
    p = Path(rel_path)
    return p.with_suffix(imageio.EXPORT_FORMATS[fmt])


def merge_fixes(fixes: dict, issues: list[qc.Issue]) -> dict:
    out = dict(fixes)
    for i in issues:
        if not i.fix or i.severity == qc.INFO:
            continue
        for k, v in i.fix.items():
            if isinstance(v, bool):
                out[k] = v
            elif k in ("alpha_erode",):
                out[k] = out.get(k, 0) + v
            elif k == "reseed":
                out["seed_offset"] = out.get("seed_offset", 0) + 1
            else:
                out[k] = out.get(k, 1.0) * v
    return out


@dataclass
class Snapshot:
    photo: imageio.Photo
    masks: dict
    info: dict
    log: list
    warnings: list


def run_steps(ctx: FrameContext, steps: list[dict], workdir: Path | None, keep_intermediate: bool,
              start: int = 0, snapshots: dict[int, Snapshot] | None = None) -> None:
    """Выполняет шаги с start. Перед шагами, зависящими от поправок QC, запоминает состояние."""
    n = len(steps)
    for i in range(start, n):
        step = steps[i]
        ctx.checkpoint()
        op = get(step["op"])
        if snapshots is not None and op.fix_keys:
            snapshots[i] = Snapshot(ctx.photo.copy(), dict(ctx.masks), dict(ctx.info), list(ctx.log), list(ctx.warnings))
        ctx.on_progress(step["title"], i / max(n, 1))
        t0 = time.time()
        op.run(ctx, dict(step.get("params", {})))
        ctx.log.append({"op": step["op"], "message": f"{step['title']}: {time.time() - t0:.1f} с"})
        if keep_intermediate and workdir is not None:
            imageio.save(ctx.photo, workdir / f"{i + 1:02d}_{step['op']}", "png", bit_depth=8)


def first_affected(steps: list[dict], old: dict, new: dict) -> int | None:
    changed = {k for k in set(old) | set(new) if old.get(k) != new.get(k)}
    for i, st in enumerate(steps):
        if changed & set(get(st["op"]).fix_keys):
            return i
    return None


def process_frame(
    *, settings: Settings, cache: ModelCache, comfy, original_path: Path, rel_path: str, frame_id: str,
    steps: list[dict], spec: dict, refs: dict[str, list[Path]], paths: JobPaths,
    should_stop: Callable[[], bool] = lambda: False,
    on_progress: Callable[[str, float], None] = lambda s, p: None,
    keep_intermediate: bool = True, max_retries: int | None = None,
) -> FrameOutcome:
    export = spec.get("export", {})
    fmt = export.get("format") or "jpeg"
    transparent = bool(export.get("transparent")) and fmt in ("png", "tiff", "webp")
    max_retries = settings.max_quality_retries if max_retries is None else max_retries
    original = imageio.load(original_path)
    workdir = paths.work / frame_id
    if workdir.exists():
        shutil.rmtree(workdir, ignore_errors=True)
    workdir.mkdir(parents=True, exist_ok=True)

    best: tuple[float, Path, list, dict, list, list] | None = None
    fixes: dict = {}
    attempts = 0
    snapshots: dict[int, Snapshot] = {}
    start = 0
    for attempt in range(max_retries + 1):
        attempts = attempt + 1
        ctx = FrameContext(
            original=original, photo=original.copy(), settings=settings, cache=cache, spec=spec,
            refs=refs, workdir=workdir, attempt=attempt, fixes=fixes, comfy=comfy,
            should_stop=should_stop, on_progress=on_progress,
        )
        if start and start in snapshots:
            snap = snapshots[start]
            ctx.photo, ctx.masks, ctx.info = snap.photo.copy(), dict(snap.masks), dict(snap.info)
            ctx.log, ctx.warnings = list(snap.log), list(snap.warnings)
            ctx.log.append({"op": "qc", "message": f"Повтор с шага «{steps[start]['title']}» с поправками {fixes}"})
        else:
            start = 0
        attempt_dir = workdir / f"attempt{attempt + 1}"
        run_steps(ctx, steps, attempt_dir, keep_intermediate, start, snapshots)
        ctx.checkpoint()
        on_progress("Сохранение и проверка", 0.95)
        out_path = imageio.save(
            ctx.photo, attempt_dir / ("result" + imageio.EXPORT_FORMATS[fmt]), fmt,
            quality=int(export.get("quality", 95)), keep_alpha=transparent,
            bit_depth=int(export.get("bit_depth") or 0) or None,
        )
        expect = ctx.photo.size
        issues, metrics = qc.run_all(ctx, steps, out_path, expect, transparent and ctx.photo.alpha is not None)
        s = qc.score(issues)
        ctx.log.append({"op": "qc", "message": f"Попытка {attempt + 1}: штраф {s:.0f}",
                        "issues": [i.code for i in issues]})
        if best is None or s < best[0]:
            best = (s, out_path, [i.to_dict() for i in issues], metrics, list(ctx.log), list(ctx.warnings))
        fixable = [i for i in issues if i.fix and i.severity in (qc.ERROR, qc.WARN)]
        if not fixable or s == 0:
            break
        new_fixes = merge_fixes(fixes, fixable)
        k = first_affected(steps, fixes, new_fixes)
        if k is None:
            break  # поправка не относится ни к одному шагу — повтор ничего не изменит
        fixes, start = new_fixes, k
        # освобождаем память между попытками
        del ctx
        gc.collect()

    assert best is not None
    s, path, issues, metrics, log, warnings = best
    has_error = any(i["severity"] == qc.ERROR for i in issues)
    has_warn = any(i["severity"] == qc.WARN for i in issues)
    status = "review" if (has_error or has_warn) else "done"
    dest_dir = paths.done if status == "done" else paths.review
    dest = dest_dir / output_name(rel_path, fmt)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, dest)
    return FrameOutcome(status=status, result_path=dest, issues=issues, metrics=metrics, log=log,
                        warnings=warnings, attempts=attempts)


def safe_process_frame(**kw) -> FrameOutcome:
    """Обёртка: превращает исключения в понятный статус, отличая временные ошибки."""
    try:
        return process_frame(**kw)
    except Cancelled:
        raise
    except MemoryError:
        return FrameOutcome(status="failed", error="Не хватило оперативной памяти для этого кадра",
                            metrics={"transient": True})
    except OperationError as e:
        return FrameOutcome(status="failed", error=str(e), metrics={"transient": e.transient})
    except imageio.ImageReadError as e:
        return FrameOutcome(status="failed", error=str(e))
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        transient = any(k in msg.lower() for k in ("out of memory", "cuda", "timed out", "connection"))
        return FrameOutcome(status="failed", error=f"Внутренняя ошибка: {type(e).__name__}: {msg}",
                            metrics={"transient": transient})

