"""История заданий и состояние кадров в SQLite.

База — единственный источник правды о прогрессе: после перезапуска
приложение читает её и продолжает с того места, где остановилось.
Готовые кадры повторно не обрабатываются.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    task_text TEXT NOT NULL DEFAULT '',
    spec_json TEXT NOT NULL DEFAULT '{}',
    plan_json TEXT NOT NULL DEFAULT '[]',
    export_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    started_at REAL,
    finished_at REAL,
    message TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS frames (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    name TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    original_path TEXT NOT NULL,
    width INTEGER, height INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    step TEXT NOT NULL DEFAULT '',
    progress REAL NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    result_path TEXT,
    qc_json TEXT NOT NULL DEFAULT '{}',
    log_json TEXT NOT NULL DEFAULT '[]',
    error TEXT NOT NULL DEFAULT '',
    override_text TEXT,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS frames_job ON frames(job_id, seq);
CREATE TABLE IF NOT EXISTS refs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT,
    frame_id TEXT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS events_job ON events(job_id, id);
"""

# Статусы кадра
PENDING, RUNNING, DONE, REVIEW, FAILED, CANCELLED = (
    "pending", "running", "done", "review", "failed", "cancelled")
# Статусы задания
DRAFT, QUEUED, JOB_RUNNING, PAUSED, JOB_DONE, JOB_CANCELLED = (
    "draft", "queued", "running", "paused", "done", "cancelled")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield self._conn
                self._conn.execute("COMMIT")
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise

    def q(self, sql: str, args: tuple = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, args).fetchall()]

    def x(self, sql: str, args: tuple = ()) -> None:
        with self._lock:
            self._conn.execute(sql, args)

    # --- задания ---
    def create_job(self, title: str = "") -> str:
        jid = new_id()
        now = time.time()
        self.x("INSERT INTO jobs(id,title,created_at,updated_at) VALUES(?,?,?,?)", (jid, title, now, now))
        return jid

    def job(self, jid: str) -> dict | None:
        rows = self.q("SELECT * FROM jobs WHERE id=?", (jid,))
        if not rows:
            return None
        j = rows[0]
        for k in ("spec_json", "plan_json", "export_json"):
            j[k[:-5]] = json.loads(j.pop(k) or "null")
        return j

    def jobs(self) -> list[dict]:
        rows = self.q("""SELECT j.id,j.title,j.task_text,j.status,j.created_at,j.updated_at,j.finished_at,j.message,
            (SELECT COUNT(*) FROM frames f WHERE f.job_id=j.id) AS total,
            (SELECT COUNT(*) FROM frames f WHERE f.job_id=j.id AND f.status='done') AS done,
            (SELECT COUNT(*) FROM frames f WHERE f.job_id=j.id AND f.status='review') AS review,
            (SELECT COUNT(*) FROM frames f WHERE f.job_id=j.id AND f.status='failed') AS failed
            FROM jobs j ORDER BY j.created_at DESC""")
        return rows

    def update_job(self, jid: str, **fields: Any) -> None:
        if not fields:
            return
        sets, args = [], []
        for k, v in fields.items():
            if k in ("spec", "plan", "export"):
                k, v = k + "_json", json.dumps(v, ensure_ascii=False)
            sets.append(f"{k}=?")
            args.append(v)
        sets.append("updated_at=?")
        args.append(time.time())
        args.append(jid)
        self.x(f"UPDATE jobs SET {','.join(sets)} WHERE id=?", tuple(args))

    def delete_job(self, jid: str) -> None:
        self.x("DELETE FROM jobs WHERE id=?", (jid,))

    # --- кадры ---
    def add_frame(self, jid: str, name: str, rel_path: str, original_path: str, width: int, height: int) -> str:
        fid = new_id()
        with self.tx() as c:
            seq = c.execute("SELECT COALESCE(MAX(seq),0)+1 FROM frames WHERE job_id=?", (jid,)).fetchone()[0]
            c.execute("""INSERT INTO frames(id,job_id,seq,name,rel_path,original_path,width,height,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?)""", (fid, jid, seq, name, rel_path, original_path, width, height, time.time()))
        return fid

    def frames(self, jid: str, status: str | None = None) -> list[dict]:
        if status:
            rows = self.q("SELECT * FROM frames WHERE job_id=? AND status=? ORDER BY seq", (jid, status))
        else:
            rows = self.q("SELECT * FROM frames WHERE job_id=? ORDER BY seq", (jid,))
        return [self._frame(r) for r in rows]

    def frame(self, fid: str) -> dict | None:
        rows = self.q("SELECT * FROM frames WHERE id=?", (fid,))
        return self._frame(rows[0]) if rows else None

    @staticmethod
    def _frame(r: dict) -> dict:
        r["qc"] = json.loads(r.pop("qc_json") or "{}")
        r["log"] = json.loads(r.pop("log_json") or "[]")
        return r

    def update_frame(self, fid: str, **fields: Any) -> None:
        sets, args = [], []
        for k, v in fields.items():
            if k in ("qc", "log"):
                k, v = k + "_json", json.dumps(v, ensure_ascii=False)
            sets.append(f"{k}=?")
            args.append(v)
        sets.append("updated_at=?")
        args.append(time.time())
        args.append(fid)
        self.x(f"UPDATE frames SET {','.join(sets)} WHERE id=?", tuple(args))

    def frames_for_review(self) -> list[dict]:
        rows = self.q("""SELECT f.*, j.title AS job_title FROM frames f JOIN jobs j ON j.id=f.job_id
            WHERE f.status IN ('review','failed') ORDER BY f.updated_at DESC""")
        return [self._frame(r) for r in rows]

    def counts(self, jid: str) -> dict[str, int]:
        rows = self.q("SELECT status, COUNT(*) AS n FROM frames WHERE job_id=? GROUP BY status", (jid,))
        out = {s: 0 for s in (PENDING, RUNNING, DONE, REVIEW, FAILED, CANCELLED)}
        out.update({r["status"]: r["n"] for r in rows})
        out["total"] = sum(v for k, v in out.items() if k != "total")
        return out

    # --- референсы ---
    def add_ref(self, jid: str, role: str, name: str, path: str) -> str:
        rid = new_id()
        self.x("INSERT INTO refs(id,job_id,role,name,path,created_at) VALUES(?,?,?,?,?,?)",
               (rid, jid, role, name, path, time.time()))
        return rid

    def refs(self, jid: str) -> list[dict]:
        return self.q("SELECT * FROM refs WHERE job_id=? ORDER BY created_at", (jid,))

    def delete_ref(self, rid: str) -> dict | None:
        rows = self.q("SELECT * FROM refs WHERE id=?", (rid,))
        self.x("DELETE FROM refs WHERE id=?", (rid,))
        return rows[0] if rows else None

    # --- журнал ---
    def log(self, level: str, message: str, job_id: str | None = None, frame_id: str | None = None) -> None:
        self.x("INSERT INTO events(job_id,frame_id,level,message,ts) VALUES(?,?,?,?,?)",
               (job_id, frame_id, level, message, time.time()))

    def events(self, jid: str, limit: int = 300) -> list[dict]:
        return self.q("SELECT * FROM events WHERE job_id=? ORDER BY id DESC LIMIT ?", (jid, limit))

    def recover_after_restart(self) -> int:
        """Кадры, прерванные выключением, возвращаются в очередь."""
        n = self.q("SELECT COUNT(*) AS n FROM frames WHERE status='running'")[0]["n"]
        self.x("UPDATE frames SET status='pending', step='', progress=0 WHERE status='running'")
        self.x("UPDATE jobs SET status='queued' WHERE status='running'")
        return n
