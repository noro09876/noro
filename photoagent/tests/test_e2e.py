"""Сквозные проверки: загрузка → задание → очередь → результат → ZIP; возобновление после перезапуска; API."""
import io
import time
import zipfile
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from photoagent import imageio
from photoagent.jobs import JobManager, UserError
from photoagent.server import create_app

from conftest import green_screen, synthetic_subject
from test_core import jpeg_bytes, make_zip


def gs_jpeg(seed=0):
    F, a = synthetic_subject(seed=seed)
    return jpeg_bytes(green_screen(F, a, seed=seed))


def bg_png():
    b = io.BytesIO()
    from PIL import Image
    arr = np.zeros((400, 600, 3), np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = 180, 160, 140
    Image.fromarray(arr).save(b, "PNG")
    return b.getvalue()


def run_all(mgr: JobManager, limit=50):
    for _ in range(limit):
        nxt = mgr._next_frame()
        if nxt is None:
            return
        mgr.run_frame(*nxt)


TASK = "Удали зелёный фон, убери зелёный ореол, помести в загруженный интерьер, согласуй освещение. Сохрани в исходном разрешении."


def test_batch_zip_report(settings):
    mgr = JobManager(settings, start_worker=False)
    jid = mgr.create_job("Тест")
    ids = mgr.add_upload(jid, "архив.zip", io.BytesIO(make_zip({
        "класс/кадр1.jpg": gs_jpeg(0), "класс/кадр2.jpg": gs_jpeg(1), "__MACOSX/._x.jpg": b"junk", "readme.txt": b"x"})))
    assert len(ids) == 2
    mgr.add_ref(jid, "background", "зал.png", io.BytesIO(bg_png()))
    res = mgr.set_task(jid, TASK)
    assert not res["plan"]["errors"], res["plan"]
    mgr.start(jid)
    run_all(mgr)
    frames = mgr.store.frames(jid)
    assert all(f["status"] in ("done", "review") for f in frames), [(f["status"], f["error"]) for f in frames]
    for f in frames:
        out = imageio.load(f["result_path"])
        assert out.size == (f["width"], f["height"])  # исходное разрешение
        assert "класс" in f["result_path"]  # структура папок сохранена
    # оригиналы не тронуты и защищены от записи
    orig = Path(frames[0]["original_path"])
    assert orig.read_bytes() == gs_jpeg(0)
    assert mgr.store.job(jid)["status"] == "done"
    zp = settings.data_dir / "t.zip"
    n = mgr.write_zip(jid, zp, include_review=True)
    assert n == 2
    with zipfile.ZipFile(zp) as z:
        assert "отчёт.html" in z.namelist()
    assert (mgr.paths(jid).reports / "report.json").exists()


def test_resume_after_restart_skips_done(settings):
    mgr = JobManager(settings, start_worker=False)
    jid = mgr.create_job()
    for i in range(3):
        mgr.add_upload(jid, f"k{i}.jpg", io.BytesIO(gs_jpeg(i)))
    mgr.set_task(jid, "Удали зелёный фон, сохрани прозрачный PNG")
    mgr.start(jid)
    job, fr = mgr._next_frame()
    mgr.run_frame(job, fr)  # обработан один кадр
    # имитация выключения посреди второго кадра
    job, fr2 = mgr._next_frame()
    mgr.store.update_frame(fr2["id"], status="running")
    done_before = mgr.store.frame(fr["id"])["updated_at"]
    mgr2 = JobManager(settings, start_worker=False)  # «перезапуск»
    assert mgr2.store.frame(fr2["id"])["status"] == "pending"
    run_all(mgr2)
    assert mgr2.store.frame(fr["id"])["updated_at"] == done_before  # готовый кадр не переделывался
    st = [f["status"] for f in mgr2.store.frames(jid)]
    assert all(s in ("done", "review") for s in st)
    res = imageio.load(mgr2.store.frame(fr2["id"])["result_path"])
    assert res.alpha is not None  # прозрачный PNG


def test_pause_cancel_and_errors(settings):
    mgr = JobManager(settings, start_worker=False)
    jid = mgr.create_job()
    with pytest.raises(UserError):
        mgr.start(jid)  # нет фото
    mgr.add_upload(jid, "a.jpg", io.BytesIO(gs_jpeg()))
    with pytest.raises(UserError):
        mgr.add_upload(jid, "a.txt", io.BytesIO(b"x"))
    with pytest.raises(UserError):
        mgr.add_upload(jid, "broken.jpg", io.BytesIO(b"broken"))
    mgr.set_task(jid, "Удали зелёный фон и помести в интерьер")
    with pytest.raises(UserError, match="фон"):
        mgr.start(jid)  # нет фонового изображения
    mgr.set_task(jid, "Убери шум")
    mgr.start(jid)
    mgr.pause(jid)
    assert mgr._next_frame() is None  # на паузе ничего не берётся
    mgr.resume(jid)
    mgr.cancel(jid)
    assert mgr.store.counts(jid)["cancelled"] == 1


def test_failed_frame_is_reported_not_crash(settings):
    mgr = JobManager(settings, start_worker=False)
    jid = mgr.create_job()
    rng = np.random.default_rng(0)
    mgr.add_upload(jid, "noise.jpg", io.BytesIO(jpeg_bytes(rng.uniform(0, 1, (64, 64, 3)))))
    # Фото без хромакея и без скачанной BiRefNet — удаление фона невозможно; план это видит заранее
    res = mgr.set_task(jid, "вырежи человека")
    assert res["plan"]["errors"]


def test_api_flow(settings):
    app = create_app(settings, start_worker=True)
    with TestClient(app) as c:
        jid = c.post("/api/jobs", data={"title": "API"}).json()["id"]
        r = c.post(f"/api/jobs/{jid}/files", files=[("files", ("a.jpg", gs_jpeg(), "image/jpeg"))]).json()
        assert r["added"] == 1
        r = c.post(f"/api/jobs/{jid}/task", json={"text": "Удали зелёный фон, сохрани прозрачный PNG"}).json()
        assert r["plan"]["steps"][0]["op"] == "remove_background"
        fid = c.get(f"/api/jobs/{jid}").json()["frames"][0]["id"]
        pv = c.post(f"/api/jobs/{jid}/preview", json={"frame": fid}).json()
        assert pv["status"] in ("done", "review") and not pv["error"]
        assert c.get(f"/api/frames/{fid}/image/preview?size=200").status_code == 200
        assert c.post(f"/api/jobs/{jid}/start").json()["ok"]
        for _ in range(120):
            d = c.get(f"/api/jobs/{jid}").json()
            if d["job"]["status"] == "done":
                break
            time.sleep(0.5)
        assert d["job"]["status"] == "done", d
        assert c.get(f"/api/frames/{fid}/image/result?size=200").headers["content-type"] == "image/jpeg"
        z = c.get(f"/api/jobs/{jid}/zip?include_review=true")
        assert z.status_code == 200 and z.content[:2] == b"PK"
        assert "Отчёт" in c.get(f"/api/jobs/{jid}/report").text
        assert c.get("/api/system").json()["comfyui"]["available"] is False
        assert any(m["id"] == "birefnet_portrait" for m in c.get("/api/models").json())
        assert c.get("/").status_code == 200
        assert c.post(f"/api/jobs/{jid}/start").status_code in (200, 400)
