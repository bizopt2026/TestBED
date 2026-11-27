"""알림 센터, 편집 권한 요청, 휴지통(되돌리기)."""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime

from . import access, storage

TRASH_KEEP_SEC = 7 * 24 * 3600  # 휴지통 보관 7일 (화면의 '되돌리기'는 10초 동안 표시)


def init() -> None:
    with storage.conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY, username TEXT, kind TEXT, text TEXT, link TEXT, created_at TEXT, read INTEGER)""")
        c.execute("CREATE INDEX IF NOT EXISTS notif_user ON notifications(username, read)")
        c.execute("""CREATE TABLE IF NOT EXISTS trash (
            id TEXT PRIMARY KEY, kind TEXT, project TEXT, label TEXT, payload BLOB, deleted_by TEXT, deleted_at REAL)""")


# ---------------------------------------------------------------- 알림
NOTIFY_TYPES = {"access": "편집 권한 요청·결과", "member": "멤버 지정·해제", "new_update": "새 업데이트 업로드",
                "mention": "코멘트 @멘션", "assigned": "담당자 지정", "review": "월간 점검 완료"}


def _type_of(kind: str) -> str:
    return "access" if kind.startswith("access") else kind


def prefs(username: str) -> dict:
    r = storage.rec_get("user_pref", username)
    d = {"start_page": "home", "term_mode": "mixed", "notify": list(NOTIFY_TYPES)}
    if r:
        d.update({k: r[k] for k in ("start_page", "term_mode", "notify") if k in r})
    return d


def set_prefs(username: str, data: dict) -> dict:
    cur = prefs(username)
    if data.get("start_page") in ("home", "portfolio", "wizard", "field", "reports"):
        cur["start_page"] = data["start_page"]
    if data.get("term_mode") in ("mixed", "ko"):
        cur["term_mode"] = data["term_mode"]
    if isinstance(data.get("notify"), list):
        cur["notify"] = [t for t in data["notify"] if t in NOTIFY_TYPES]
    storage.rec_put("user_pref", username, cur, username, rid=username)
    return cur


def push(usernames, kind: str, text: str, link: str = "", exclude: str | None = None) -> None:
    init()
    now = datetime.now().isoformat(timespec="seconds")
    with storage.conn() as c:
        for u in dict.fromkeys(usernames):
            if u and u != exclude and _type_of(kind) in prefs(u)["notify"]:
                c.execute("INSERT INTO notifications VALUES (?,?,?,?,?,?,0)", (uuid.uuid4().hex[:12], u, kind, text[:300], link[:200], now))


def admins() -> list[str]:
    with storage.conn() as c:
        return [r["username"] for r in c.execute("SELECT username FROM users WHERE role='admin' AND active=1")]


def project_people(project: str, roles=("owner", "member")) -> list[str]:
    return [m["username"] for m in access.members(project) if m["role"] in roles]


def listing(username: str, limit: int = 50) -> dict:
    init()
    with storage.conn() as c:
        rows = c.execute("SELECT * FROM notifications WHERE username=? ORDER BY created_at DESC LIMIT ?", (username, limit)).fetchall()
        unread = c.execute("SELECT COUNT(*) FROM notifications WHERE username=? AND read=0", (username,)).fetchone()[0]
    return {"unread": unread, "items": [dict(r) for r in rows]}


def mark_read(username: str, ids: list[str] | None) -> None:
    init()
    with storage.conn() as c:
        if ids:
            c.executemany("UPDATE notifications SET read=1 WHERE username=? AND id=?", [(username, i) for i in ids])
        else:
            c.execute("UPDATE notifications SET read=1 WHERE username=?", (username,))


# ---------------------------------------------------------------- 편집 권한 요청
def request_access(project: str, username: str, message: str) -> str:
    pending = [r for r in storage.rec_list("access_req", project) if r["username"] == username and r["status"] == "pending"]
    if pending:
        return pending[0]["id"]
    rid = storage.rec_put("access_req", project, {"username": username, "message": message[:300], "status": "pending"}, username)
    push(project_people(project, ("owner",)) or admins(), "access_request",
         f"{username} 님이 '{project}' 편집 권한을 요청했습니다" + (f": {message[:80]}" if message else ""), "#/projects")
    return rid


def requests_for(project: str) -> list[dict]:
    return [r for r in storage.rec_list("access_req", project) if r["status"] == "pending"]


def decide(project: str, rid: str, approve: bool, by: str, role: str = "member") -> dict:
    r = storage.rec_get("access_req", rid)
    if not r or r["scope"] != project or r["status"] != "pending":
        raise ValueError("처리할 요청이 없습니다")
    if approve:
        access.set_member(project, r["username"], role, by)
    storage.rec_put("access_req", project, {**{k: r[k] for k in ("username", "message")}, "status": "approved" if approve else "rejected",
                                            "decided_by": by}, by, rid=rid)
    push([r["username"]], "access_" + ("approved" if approve else "rejected"),
         f"'{project}' 편집 권한 요청이 {'승인' if approve else '거절'}되었습니다 ({by})", "#/projects")
    return {"ok": True}


# ---------------------------------------------------------------- 휴지통
def stash(kind: str, project: str, label: str, payload: dict, by: str) -> str:
    init()
    tid = uuid.uuid4().hex[:12]
    with storage.conn() as c:
        c.execute("DELETE FROM trash WHERE deleted_at < ?", (time.time() - TRASH_KEEP_SEC,))
        c.execute("INSERT INTO trash VALUES (?,?,?,?,?,?,?)", (tid, kind, project, label[:120], json.dumps(payload, ensure_ascii=False, default=_b64).encode(), by, time.time()))
    return tid


def _b64(o):
    import base64
    if isinstance(o, (bytes, bytearray)):
        return {"__b64__": base64.b64encode(o).decode()}
    raise TypeError(type(o))


def _unb64(d):
    import base64
    if isinstance(d, dict) and set(d) == {"__b64__"}:
        return base64.b64decode(d["__b64__"])
    return d


def get(tid: str):
    init()
    with storage.conn() as c:
        r = c.execute("SELECT * FROM trash WHERE id=?", (tid,)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["payload"] = json.loads(d["payload"], object_hook=_unb64)
    return d


def drop(tid: str) -> None:
    with storage.conn() as c:
        c.execute("DELETE FROM trash WHERE id=?", (tid,))


def recent(project: str | None = None, limit: int = 50) -> list[dict]:
    init()
    with storage.conn() as c:
        if project:
            rows = c.execute("SELECT id, kind, project, label, deleted_by, deleted_at FROM trash WHERE project=? ORDER BY deleted_at DESC LIMIT ?", (project, limit)).fetchall()
        else:
            rows = c.execute("SELECT id, kind, project, label, deleted_by, deleted_at FROM trash ORDER BY deleted_at DESC LIMIT ?", (limit,)).fetchall()
    return [{**dict(r), "deleted_at": datetime.fromtimestamp(r["deleted_at"]).isoformat(timespec="seconds")} for r in rows]


# ---- 종류별 삭제·복원
def delete_record(kind: str, rid: str, by: str) -> str:
    r = storage.rec_get(kind, rid)
    full = storage.rec_list(kind, r["scope"])
    item = next(x for x in full if x["id"] == rid)
    label = item.get("title") or item.get("desc") or item.get("name") or item.get("code") or kind
    tid = stash("record", r["scope"], f"{ {'risk': '리스크', 'constraint': '제약', 'commit': '약속', 'view': '보기', 'baseline': '베이스라인'}.get(kind, kind)}: {label}",
                {"kind": kind, "item": item}, by)
    storage.rec_del(kind, rid)
    return tid


def delete_scenario(sid: str, by: str) -> str:
    sc = storage.get_scenario(sid)
    d = storage.get(sc["upload_id"])
    tid = stash("scenario", d["name"] if d else "", f"시나리오: {sc['name']}", {"scenario": sc}, by)
    storage.delete_scenario(sid)
    return tid


def delete_upload(uid: str, by: str) -> str:
    with storage.conn() as c:
        up = dict(c.execute("SELECT * FROM uploads WHERE id=?", (uid,)).fetchone())
        extras = [dict(r) for r in c.execute("SELECT * FROM extras WHERE upload_id=?", (uid,))]
        scen = [dict(r) for r in c.execute("SELECT * FROM scenarios WHERE upload_id=?", (uid,))]
    tid = stash("upload", up["name"], f"업로드: {up['name']} (DD {up['data_date']})", {"upload": up, "extras": extras, "scenarios": scen}, by)
    storage.delete(uid)
    return tid


def restore(tid: str) -> dict:
    t = get(tid)
    if not t:
        raise KeyError(tid)
    p = t["payload"]
    with storage.conn() as c:
        if t["kind"] == "record":
            it = p["item"]
            data = {k: v for k, v in it.items() if k not in ("id", "scope", "author", "created_at", "updated_at")}
            c.execute("INSERT OR REPLACE INTO records VALUES (?,?,?,?,?,?,?)",
                      (p["kind"], it["scope"], it["id"], json.dumps(data, ensure_ascii=False), it.get("author", ""), it.get("created_at", ""), it.get("updated_at", "")))
        elif t["kind"] == "scenario":
            sc = p["scenario"]
            c.execute("INSERT OR REPLACE INTO scenarios VALUES (?,?,?,?,?,?,?,?)",
                      (sc["id"], sc["upload_id"], sc["name"], sc["kind"], json.dumps(sc["changes"], ensure_ascii=False),
                       json.dumps(sc["summary"], ensure_ascii=False), sc["author"], sc["created_at"]))
        elif t["kind"] == "upload":
            u = p["upload"]
            c.execute("INSERT OR REPLACE INTO uploads VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                      tuple(u[k] for k in ("id", "filename", "proj_id", "name", "uploader", "note", "created_at", "data_date", "finish", "activities", "raw", "result")))
            for e in p["extras"]:
                c.execute("INSERT OR REPLACE INTO extras VALUES (?,?,?,?)", (e["upload_id"], e["kind"], e["data"], e["updated_at"]))
            for s in p["scenarios"]:
                c.execute("INSERT OR REPLACE INTO scenarios VALUES (?,?,?,?,?,?,?,?)", tuple(s[k] for k in ("id", "upload_id", "name", "kind", "changes", "summary", "author", "created_at")))
    drop(tid)
    return {"ok": True, "kind": t["kind"], "project": t["project"]}
