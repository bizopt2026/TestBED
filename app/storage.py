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
        c.execute("""CREATE TABLE IF NOT EXISTS extras (
            upload_id TEXT, kind TEXT, data TEXT, updated_at TEXT, PRIMARY KEY (upload_id, kind))""")
        c.execute("""CREATE TABLE IF NOT EXISTS scenarios (
            id TEXT PRIMARY KEY, upload_id TEXT, name TEXT, kind TEXT, changes TEXT, summary TEXT,
            author TEXT, created_at TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS records (
            kind TEXT, scope TEXT, id TEXT, data TEXT, author TEXT, created_at TEXT, updated_at TEXT,
            PRIMARY KEY (kind, id))""")
        c.execute("CREATE INDEX IF NOT EXISTS records_scope ON records(kind, scope)")
        c.execute("""CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY, pw_hash TEXT, role TEXT, active INTEGER, created_at TEXT, last_login TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, username TEXT, expires_at REAL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS audit (
            at TEXT, username TEXT, method TEXT, path TEXT, status INTEGER, detail TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY, scope TEXT, ref TEXT, mime TEXT, data BLOB, author TEXT, created_at TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS usage (
            username TEXT, screen TEXT, day TEXT, n INTEGER, PRIMARY KEY (username, screen, day))""")
        c.execute("""CREATE TABLE IF NOT EXISTS ai_log (
            at TEXT, upload_id TEXT, feature TEXT, user TEXT, tokens_in INTEGER, tokens_out INTEGER,
            seconds REAL, ok INTEGER)""")


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
        c.execute("DELETE FROM extras WHERE upload_id=?", (uid,))
        c.execute("DELETE FROM scenarios WHERE upload_id=?", (uid,))
        return c.execute("DELETE FROM uploads WHERE id=?", (uid,)).rowcount > 0


def history(name: str) -> list[dict]:
    """같은 프로젝트(이름 기준)의 모든 업로드 (결과 포함, 오래된 순)."""
    with conn() as c:
        rows = c.execute("SELECT id, data_date, created_at, result FROM uploads WHERE name=? "
                         "ORDER BY data_date, created_at", (name,)).fetchall()
    return [{"id": r["id"], "data_date": r["data_date"], "created_at": r["created_at"], "result": json.loads(r["result"])} for r in rows]


def all_results() -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT id, result FROM uploads").fetchall()
    return [{"id": r["id"], "result": json.loads(r["result"])} for r in rows]


def get_extra(uid: str, kind: str):
    with conn() as c:
        r = c.execute("SELECT data FROM extras WHERE upload_id=? AND kind=?", (uid, kind)).fetchone()
    return json.loads(r["data"]) if r else None


def all_extras(kind: str) -> dict[str, object]:
    with conn() as c:
        rows = c.execute("SELECT upload_id, data FROM extras WHERE kind=?", (kind,)).fetchall()
    return {r["upload_id"]: json.loads(r["data"]) for r in rows}


def set_extra(uid: str, kind: str, data) -> None:
    with conn() as c:
        c.execute("INSERT OR REPLACE INTO extras VALUES (?,?,?,?)",
                  (uid, kind, json.dumps(data, ensure_ascii=False), datetime.now().isoformat(timespec="seconds")))


def del_extra(uid: str, kind: str) -> None:
    with conn() as c:
        c.execute("DELETE FROM extras WHERE upload_id=? AND kind=?", (uid, kind))


def save_scenario(upload_id, name, kind, changes, summary, author) -> str:
    sid = uuid.uuid4().hex[:10]
    with conn() as c:
        c.execute("INSERT INTO scenarios VALUES (?,?,?,?,?,?,?,?)", (
            sid, upload_id, name, kind, json.dumps(changes, ensure_ascii=False),
            json.dumps(summary, ensure_ascii=False), author, datetime.now().isoformat(timespec="seconds")))
    return sid


def scenarios(upload_id: str) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT * FROM scenarios WHERE upload_id=? ORDER BY created_at DESC", (upload_id,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["changes"] = json.loads(d["changes"])
        d["summary"] = json.loads(d["summary"])
        out.append(d)
    return out


def get_scenario(sid: str):
    with conn() as c:
        r = c.execute("SELECT * FROM scenarios WHERE id=?", (sid,)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["changes"] = json.loads(d["changes"])
    d["summary"] = json.loads(d["summary"])
    return d


def delete_scenario(sid: str) -> bool:
    with conn() as c:
        return c.execute("DELETE FROM scenarios WHERE id=?", (sid,)).rowcount > 0


def log_ai(upload_id, feature, user, usage, seconds, ok) -> None:
    with conn() as c:
        c.execute("INSERT INTO ai_log VALUES (?,?,?,?,?,?,?,?)", (
            datetime.now().isoformat(timespec="seconds"), upload_id, feature, user,
            (usage or {}).get("in", 0), (usage or {}).get("out", 0), seconds, 1 if ok else 0))


def ai_usage() -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT feature, COUNT(*) n, SUM(tokens_in) tin, SUM(tokens_out) tout, "
                         "SUM(1-ok) failed FROM ai_log GROUP BY feature").fetchall()
    return [dict(r) for r in rows]



# ---------------------------------------------------------------- 범용 레코드 (리스크, 약속, 제약, 설정 등)
def rec_list(kind: str, scope: str | None = None) -> list[dict]:
    with conn() as c:
        if scope is None:
            rows = c.execute("SELECT * FROM records WHERE kind=? ORDER BY created_at", (kind,)).fetchall()
        else:
            rows = c.execute("SELECT * FROM records WHERE kind=? AND scope=? ORDER BY created_at", (kind, scope)).fetchall()
    return [{**json.loads(r["data"]), "id": r["id"], "scope": r["scope"], "author": r["author"],
             "created_at": r["created_at"], "updated_at": r["updated_at"]} for r in rows]


def rec_get(kind: str, rid: str):
    with conn() as c:
        r = c.execute("SELECT * FROM records WHERE kind=? AND id=?", (kind, rid)).fetchone()
    return {**json.loads(r["data"]), "id": r["id"], "scope": r["scope"], "updated_at": r["updated_at"]} if r else None


SYNC_KINDS = ("risk", "constraint")   # 현장 ↔ 대시보드 양방향 동기화 대상 (지우면 tomb 를 남김)
SCOPED_KINDS = ("risk", "constraint", "commit", "comment")   # 프로젝트 데이터: 다른 프로젝트의 같은 id를 덮어쓰지 못함


class RecordScopeError(ValueError):
    """다른 프로젝트에 속한 레코드 id로 쓰려 함 (가져오기·게시 패키지의 id 충돌)."""


def rec_scope(kind: str, rid: str):
    with conn() as c:
        r = c.execute("SELECT scope FROM records WHERE kind=? AND id=?", (kind, rid)).fetchone()
    return r["scope"] if r else None


def rec_put(kind: str, scope: str, data: dict, author: str = "", rid: str | None = None,
            updated_at: str | None = None, created_at: str | None = None) -> str:
    now = datetime.now().isoformat(timespec="seconds")
    upd = updated_at or now
    data = {k: v for k, v in data.items() if k not in ("id", "scope", "author", "created_at", "updated_at")}
    with conn() as c:
        if rid:
            old = c.execute("SELECT created_at, author, scope FROM records WHERE kind=? AND id=?", (kind, rid)).fetchone()
            if old and kind in SCOPED_KINDS and old["scope"] != scope:
                raise RecordScopeError(f"{kind} {rid} 는 다른 프로젝트의 기록입니다")
            c.execute("INSERT OR REPLACE INTO records VALUES (?,?,?,?,?,?,?)",
                      (kind, scope, rid, json.dumps(data, ensure_ascii=False), old["author"] if old else author,
                       old["created_at"] if old else (created_at or now), upd))
            if kind in SYNC_KINDS:
                c.execute("DELETE FROM records WHERE kind='tomb' AND id=?", (_tomb_id(scope, kind, rid),))
            return rid
        rid = uuid.uuid4().hex[:10]
        c.execute("INSERT INTO records VALUES (?,?,?,?,?,?,?)",
                  (kind, scope, rid, json.dumps(data, ensure_ascii=False), author, created_at or now, upd))
    return rid


def _tomb_id(scope: str, kind: str, rid: str) -> str:
    return f"{scope}\x1f{kind}:{rid}"


def tomb_put(scope: str, kind: str, rid: str, at: str | None = None) -> None:
    at = at or datetime.now().isoformat(timespec="seconds")
    with conn() as c:
        c.execute("INSERT OR REPLACE INTO records VALUES ('tomb',?,?,?,?,?,?)",
                  (scope, _tomb_id(scope, kind, rid), json.dumps({"kind": kind, "rid": rid, "at": at}), "", at, at))


def rec_del(kind: str, rid: str, at: str | None = None, tomb: bool = True) -> bool:
    with conn() as c:
        r = c.execute("SELECT scope FROM records WHERE kind=? AND id=?", (kind, rid)).fetchone()
        ok = c.execute("DELETE FROM records WHERE kind=? AND id=?", (kind, rid)).rowcount > 0
    if ok and tomb and kind in SYNC_KINDS:
        tomb_put(r["scope"], kind, rid, at)
    return ok


def setting(scope: str, key: str, default=None):
    r = rec_get("setting", f"{scope}::{key}")
    return r["value"] if r else default


def set_setting(scope: str, key: str, value, author: str = "") -> None:
    rec_put("setting", scope, {"value": value}, author, rid=f"{scope}::{key}")


def latest_by_project() -> list[dict]:
    with conn() as c:
        rows = c.execute("""SELECT u.id, u.name, u.data_date, u.finish, u.activities, u.created_at FROM uploads u
            JOIN (SELECT name, MAX(data_date) dd FROM uploads GROUP BY name) m ON u.name=m.name AND u.data_date=m.dd
            ORDER BY u.name, u.created_at DESC""").fetchall()
    seen, out = set(), []
    for r in rows:
        if r["name"] not in seen:
            seen.add(r["name"])
            out.append(dict(r))
    return out


def audit(username, method, path, status, detail="") -> None:
    with conn() as c:
        c.execute("INSERT INTO audit VALUES (?,?,?,?,?,?)",
                  (datetime.now().isoformat(timespec="seconds"), username, method, path, status, detail[:500]))


def audit_list(limit: int = 300) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT * FROM audit ORDER BY at DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]



def file_put(scope: str, ref: str, mime: str, data: bytes, author: str) -> str:
    fid = uuid.uuid4().hex[:16]
    with conn() as c:
        c.execute("INSERT INTO files VALUES (?,?,?,?,?,?,?)",
                  (fid, scope, ref, mime, data, author, datetime.now().isoformat(timespec="seconds")))
    return fid


def file_get(fid: str):
    with conn() as c:
        r = c.execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone()
    return dict(r) if r else None


def file_list(scope: str, ref: str | None = None) -> list[dict]:
    with conn() as c:
        if ref:
            rows = c.execute("SELECT id, scope, ref, mime, author, created_at FROM files WHERE scope=? AND ref=?", (scope, ref)).fetchall()
        else:
            rows = c.execute("SELECT id, scope, ref, mime, author, created_at FROM files WHERE scope=?", (scope,)).fetchall()
    return [dict(r) for r in rows]


def file_del(fid: str) -> bool:
    with conn() as c:
        return c.execute("DELETE FROM files WHERE id=?", (fid,)).rowcount > 0


# ---------------------------------------------------------------- 화면 사용 집계 (개선 근거용, 일 단위 횟수만)
def usage_hit(username: str, screen: str) -> None:
    day = datetime.now().date().isoformat()
    with conn() as c:
        c.execute("INSERT INTO usage VALUES (?,?,?,1) ON CONFLICT(username, screen, day) DO UPDATE SET n = n + 1",
                  (username or "익명", screen[:40], day))


def usage_mine(username: str) -> dict[str, int]:
    with conn() as c:
        rows = c.execute("SELECT screen, SUM(n) n FROM usage WHERE username=? GROUP BY screen", (username,)).fetchall()
    return {r["screen"]: r["n"] for r in rows}


def usage_stats(days: int = 90) -> list[dict]:
    from datetime import timedelta
    since = (datetime.now().date() - timedelta(days=days)).isoformat()
    with conn() as c:
        rows = c.execute("SELECT screen, SUM(n) views, COUNT(DISTINCT username) users FROM usage WHERE day >= ? "
                         "GROUP BY screen ORDER BY views DESC", (since,)).fetchall()
    return [dict(r) for r in rows]


def name_of(uid: str) -> str | None:
    """업로드 ID → 프로젝트 이름 (결과 JSON 을 읽지 않는 가벼운 조회)."""
    with conn() as c:
        r = c.execute("SELECT name FROM uploads WHERE id=?", (uid,)).fetchone()
    return r["name"] if r else None
