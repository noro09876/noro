"""Запуск: python -m photoagent [serve|models|run|check]"""
from __future__ import annotations

import argparse
import sys
import threading
import time
import webbrowser
from pathlib import Path


def cmd_serve(args) -> None:
    import uvicorn

    from .config import load_settings
    from .server import create_app

    s = load_settings(args.data)
    if args.port:
        s.port = args.port
    app = create_app(s)
    url = f"http://{s.host}:{s.port}"
    print(f"PhotoAgent запущен: {url}\nПапка данных: {s.data_dir}\nОстановить: Ctrl+C")
    if not args.no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=s.host, port=s.port, log_level="warning")


def cmd_models(args) -> None:
    from . import models as m
    from .config import load_settings

    s = load_settings(args.data)
    if args.action == "list":
        for st in m.status(s.models_dir):
            print(f"{'✓' if st['installed'] else ' '} {st['id']:20s} {st['size_mb']:5d} МБ  {st['license']:10s} {st['title']}")
        return
    ids = [i for i, info in m.MODELS.items() if info.required] if args.ids == ["required"] else \
        list(m.MODELS) if args.ids == ["all"] else args.ids
    for mid in ids:
        if m.is_installed(s.models_dir, mid):
            print(f"{mid}: уже установлена")
            continue
        print(f"{mid}: скачивание…", flush=True)
        last = [0.0]

        def prog(done, total, mid=mid):
            if time.time() - last[0] > 2:
                last[0] = time.time()
                print(f"  {done / 2**20:.0f}/{total / 2**20:.0f} МБ", flush=True)
        m.download(s.models_dir, mid, prog)
        print(f"{mid}: готово")


def cmd_run(args) -> None:
    """Пакетная обработка из командной строки (без интерфейса)."""
    from .config import load_settings
    from .jobs import JobManager

    s = load_settings(args.data)
    mgr = JobManager(s, start_worker=False)
    jid = mgr.create_job(args.title or Path(args.input).name)
    src = Path(args.input)
    files = [src] if src.is_file() else sorted(p for p in src.rglob("*") if p.is_file())
    for p in files:
        rel = p.name if src.is_file() else p.relative_to(src).as_posix()
        if p.suffix.lower() == ".zip" or p.suffix.lower() in (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".bmp"):
            with open(p, "rb") as f:
                mgr.add_upload(jid, rel, f)
    for ref in args.background or []:
        with open(ref, "rb") as f:
            mgr.add_ref(jid, "background", Path(ref).name, f)
    for ref in args.clothes or []:
        with open(ref, "rb") as f:
            mgr.add_ref(jid, "clothes", Path(ref).name, f)
    res = mgr.set_task(jid, args.task, {"format": args.format} if args.format else None)
    print("Понял:", "; ".join(res["spec"]["understood"]) or "—")
    for w in res["plan"]["warnings"]:
        print("Предупреждение:", w)
    if res["plan"]["errors"]:
        print("Ошибки:", *res["plan"]["errors"], sep="\n  ")
        sys.exit(2)
    mgr.start(jid)
    while True:
        nxt = mgr._next_frame()
        if nxt is None:
            break
        job, fr = nxt
        print(f"→ {fr['rel_path']}", flush=True)
        mgr.run_frame(job, fr)
        f2 = mgr.store.frame(fr["id"])
        print(f"   {f2['status']}" + (f": {f2['error']}" if f2["error"] else ""))
    counts = mgr.store.counts(jid)
    print(f"Итого: готово {counts['done']}, на проверку {counts['review']}, ошибок {counts['failed']}")
    print("Результаты:", mgr.paths(jid).root)


def cmd_check(args) -> None:
    """Проверка окружения: Python, библиотеки, ускорители, ComfyUI."""
    import platform

    import cv2
    import numpy
    import onnxruntime as ort

    from .comfy import ComfyClient
    from .config import load_settings
    s = load_settings(args.data)
    print("Python", sys.version.split()[0], platform.machine(), platform.system(), platform.release())
    print("numpy", numpy.__version__, "| OpenCV", cv2.__version__, "| onnxruntime", ort.__version__)
    print("ONNX провайдеры:", ", ".join(ort.get_available_providers()))
    c = ComfyClient(s.comfyui_url)
    print("ComfyUI:", c.capabilities() if c.ready() else f"не запущен ({s.comfyui_url})")
    from . import models as m
    for st in m.status(s.models_dir):
        print(f"  модель {st['id']}: {'есть' if st['installed'] else 'нет'}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="photoagent", description="PhotoAgent — локальная пакетная обработка фото")
    ap.add_argument("--data", help="папка данных (по умолчанию photoagent_data рядом с программой)")
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("serve", help="запустить веб-интерфейс")
    p.add_argument("--port", type=int)
    p.add_argument("--no-browser", action="store_true")
    p = sub.add_parser("models", help="список и скачивание моделей")
    p.add_argument("action", choices=["list", "download"])
    p.add_argument("ids", nargs="*", default=["required"])
    p = sub.add_parser("run", help="обработать папку без интерфейса")
    p.add_argument("input")
    p.add_argument("task")
    p.add_argument("--title")
    p.add_argument("--format")
    p.add_argument("--background", action="append")
    p.add_argument("--clothes", action="append")
    sub.add_parser("check", help="проверить окружение")
    args = ap.parse_args()
    {"serve": cmd_serve, "models": cmd_models, "run": cmd_run, "check": cmd_check}.get(args.cmd or "serve", cmd_serve)(
        args if args.cmd else ap.parse_args(["serve"]))


if __name__ == "__main__":
    main()
