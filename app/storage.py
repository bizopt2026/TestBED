"""SQLite 기반 공유 저장소 (팀원이 업로드한 XER 및 분석 결과)."""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "data", "app.db"))


@contextmanager
def conn():
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init() -> None:
    with conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS uploads (
            id TEXT PRIMARY KEY, filename TEXT, proj_id TEXT, name TEXT,
            uploader TEXT, note TEXT, created_at TEXT, data_date TEXT, finish TEXT,
            activities INTEGER, raw BLOB, result TEXT)""")


def save(filename, proj_id, name, uploader, note, raw: bytes, result: dict) -> str:
    uid = uuid.uuid4().hex[:12]
    with conn() as c:
        c.execute("INSERT INTO uploads VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (
            uid, filename, proj_id, name, uploader, note,
            datetime.now().isoformat(timespec="seconds"), result["data_date"], result["finish"],
            len(result["activities"]), raw, json.dumps(result, ensure_ascii=False)))
    return uid


def listing() -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT id, filename, proj_id, name, uploader, note, created_at, data_date, "
                         "finish, activities FROM uploads ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def get(uid: str) -> dict | None:
    with conn() as c:
        r = c.execute("SELECT * FROM uploads WHERE id=?", (uid,)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["result"] = json.loads(d["result"])
    return d


def get_raw(uid: str):
    with conn() as c:
        r = c.execute("SELECT filename, raw, proj_id FROM uploads WHERE id=?", (uid,)).fetchone()
    return dict(r) if r else None


def update_result(uid: str, result: dict) -> None:
    with conn() as c:
        c.execute("UPDATE uploads SET result=?, finish=? WHERE id=?",
                  (json.dumps(result, ensure_ascii=False), result["finish"], uid))


def delete(uid: str) -> bool:
    with conn() as c:
        return c.execute("DELETE FROM uploads WHERE id=?", (uid,)).rowcount > 0
