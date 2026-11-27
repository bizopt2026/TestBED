"""PMS 대시보드(서버)의 프로젝트 저장소 — 게시·판 관리·카탈로그·구독·공유 코드·편집 소유권·기기 토큰 (설계 6.3, 7장).

PMS 현장은 '기기 토큰'(사용자 계정으로 한 번 연결해 받은 토큰)으로 /hub/v1 API를 부른다.
게시된 판은 바뀌지 않으며, 서버는 게시된 판을 자기 프로젝트로도 저장해 대시보드·분석에 그대로 쓴다.
"""
from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta

from . import storage

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # 헷갈리는 0/O/1/I 제외


def init() -> None:
    with storage.conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS hub_devices (
            token_hash TEXT PRIMARY KEY, username TEXT, name TEXT, created_at TEXT, last_seen TEXT, revoked INTEGER DEFAULT 0)""")
        c.execute("""CREATE TABLE IF NOT EXISTS hub_projects (
            pid TEXT PRIMARY KEY, name TEXT, owner TEXT, lock_device TEXT, lock_user TEXT, lock_at TEXT, scope TEXT, created_at TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS hub_snapshots (
            pid TEXT, version INTEGER, upload_id TEXT, file_id TEXT, sha256 TEXT, size INTEGER, publisher TEXT, device TEXT,
            published_at TEXT, note TEXT, data_date TEXT, finish TEXT, PRIMARY KEY (pid, version))""")
        c.execute("""CREATE TABLE IF NOT EXISTS hub_codes (
            code TEXT PRIMARY KEY, pid TEXT, version INTEGER, target_user TEXT, expires_at TEXT, max_uses INTEGER, uses INTEGER,
            revoked INTEGER, created_by TEXT, created_at TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS hub_subs (username TEXT, pid TEXT, created_at TEXT, PRIMARY KEY (username, pid))""")


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class HubError(Exception):
    def __init__(self, status: int, message: str, extra: dict | None = None):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra or {}


# ---------------------------------------------------------------- 기기 토큰
def register_device(username: str, password: str, name: str, ip: str = "") -> dict:
    from . import auth
    init()
    if not auth.users_exist():
        raise HubError(400, "PMS 대시보드에 사용자 계정이 없습니다. 관리자 계정을 먼저 만드세요")
    try:
        ok = auth.check_password(username, password, ip=ip)
    except PermissionError as e:
        raise HubError(429, str(e))
    if not ok:
        raise HubError(401, "PMS 대시보드 아이디 또는 비밀번호가 맞지 않습니다")
    token = secrets.token_urlsafe(32)
    with storage.conn() as c:
        c.execute("INSERT INTO hub_devices VALUES (?,?,?,?,?,0)", (hashlib.sha256(token.encode()).hexdigest(), username, (name or "PC")[:60], _now(), _now()))
    storage.audit(username, "POST", "/hub/v1/devices", 200, f"기기 등록: {name}")
    return {"token": token, "username": username}


def device_user(token: str | None) -> tuple[dict, str]:
    """토큰 → (사용자, 기기 ID). 없거나 끊긴 토큰은 401."""
    init()
    if not token:
        raise HubError(401, "PMS 대시보드 연결 정보가 없습니다")
    th = hashlib.sha256(token.encode()).hexdigest()
    with storage.conn() as c:
        r = c.execute("""SELECT d.username, d.name, u.role, u.active FROM hub_devices d JOIN users u ON u.username=d.username
                         WHERE d.token_hash=? AND d.revoked=0""", (th,)).fetchone()
        if not r or not r["active"]:
            raise HubError(401, "PMS 대시보드 연결이 끊겼습니다. 내 설정에서 다시 연결하세요")
        c.execute("UPDATE hub_devices SET last_seen=? WHERE token_hash=?", (_now(), th))
    return {"username": r["username"], "role": r["role"]}, th[:16]


def devices(username: str | None = None) -> list[dict]:
    init()
    with storage.conn() as c:
        q = "SELECT substr(token_hash,1,16) id, username, name, created_at, last_seen, revoked FROM hub_devices"
        rows = c.execute(q + (" WHERE username=?" if username else "") + " ORDER BY last_seen DESC", ((username,) if username else ())).fetchall()
    return [dict(r) for r in rows]


def revoke_device(dev_id: str) -> None:
    with storage.conn() as c:
        c.execute("UPDATE hub_devices SET revoked=1 WHERE substr(token_hash,1,16)=?", (dev_id,))


# ---------------------------------------------------------------- 프로젝트·권한
def project(pid: str) -> dict | None:
    init()
    with storage.conn() as c:
        r = c.execute("SELECT * FROM hub_projects WHERE pid=?", (pid,)).fetchone()
    return dict(r) if r else None


def _can_read(user: dict, p: dict) -> bool:
    return (p.get("scope") or "all") == "all" or user["role"] == "admin" or _can_write(user, p)


def _can_write(user: dict, p: dict) -> bool:
    from . import access
    return access.can_write(user, p["name"])


def latest(pid: str) -> dict | None:
    with storage.conn() as c:
        r = c.execute("SELECT * FROM hub_snapshots WHERE pid=? ORDER BY version DESC LIMIT 1", (pid,)).fetchone()
    return dict(r) if r else None


def snapshot(pid: str, version: int | None = None) -> dict | None:
    if version is None:
        return latest(pid)
    with storage.conn() as c:
        r = c.execute("SELECT * FROM hub_snapshots WHERE pid=? AND version=?", (pid, version)).fetchone()
    return dict(r) if r else None


def package_bytes(snap: dict) -> bytes:
    return storage.file_get(snap["file_id"])["data"]


# ---------------------------------------------------------------- 게시
def publish(user: dict, device: str, data: bytes, note: str = "", take_lock: bool = False) -> dict:
    """패키지를 새 판으로 게시. 같은 프로젝트는 편집 소유권을 가진 기기에서만 게시."""
    from . import access, notify, package, services
    init()
    if user.get("role") not in ("editor", "admin"):
        raise HubError(403, "조회 전용 계정은 게시할 수 없습니다 (편집자 이상)")
    manifest, files = package.read(data)
    pid = manifest["pid"]
    p = project(pid)
    if not p:
        name = manifest["project"]
        if access.project_exists(name):
            name = f"{name} ({pid[:4]})"
        with storage.conn() as c:
            c.execute("INSERT INTO hub_projects VALUES (?,?,?,?,?,?,?,?)", (pid, name, user["username"], device, user["username"], _now(), "all", _now()))
        access.claim_new(name, user["username"])
        p = project(pid)
    elif not _can_write(user, p):
        raise HubError(403, f"'{p['name']}' 프로젝트에 게시할 권한이 없습니다 (소유자·멤버만)")
    if p["lock_device"] and p["lock_device"] != device:
        if not take_lock:
            raise HubError(409, f"다른 PC가 이 프로젝트의 편집 소유권을 가지고 있습니다 ({p['lock_user']}, {p['lock_at'][:16].replace('T', ' ')})",
                           {"lock": {"user": p["lock_user"], "at": p["lock_at"]}})
        if not access.can_manage(user, p["name"]) and p["lock_user"] != user["username"]:
            raise HubError(403, "편집 소유권은 프로젝트 소유자나 관리자만 가져올 수 있습니다")
    with storage.conn() as c:
        c.execute("UPDATE hub_projects SET lock_device=?, lock_user=?, lock_at=? WHERE pid=?", (device, user["username"], _now(), pid))
    last = latest(pid)
    ver = (last["version"] if last else 0) + 1
    data = package.with_manifest(data, version=ver, project=p["name"], published_at=_now(), publisher=user["username"])
    uid = package.import_as_project(data, p["name"], user["username"], note=f"v{ver} {note}".strip())
    fid = storage.file_put(p["name"], f"hub:{pid}:{ver}", "application/zip", data, user["username"])
    r = services.result(uid)
    with storage.conn() as c:
        c.execute("INSERT INTO hub_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                  (pid, ver, uid, fid, hashlib.sha256(data).hexdigest(), len(data), user["username"], device, _now(), note[:500], r["data_date"], r["finish"]))
    subs = [s["username"] for s in subscribers(pid)]
    notify.push(set(subs) | set(notify.project_people(p["name"])), "new_update",
                f"'{p['name']}' v{ver}(DD {r['data_date']})을 {user['username']} 님이 게시했습니다", f"#/p/{uid}/overview", exclude=user["username"])
    storage.audit(user["username"], "POST", f"/hub/v1/projects/{pid}/snapshots", 200, f"v{ver} {p['name']}")
    try:
        from . import issues
        issues.evaluate(uid)
    except ImportError:
        pass
    return {"pid": pid, "version": ver, "name": p["name"], "upload_id": uid}


def lock_info(pid: str) -> dict:
    p = project(pid)
    if not p:
        raise HubError(404, "PMS 대시보드에 게시된 적 없는 프로젝트입니다")
    return {"device": p["lock_device"], "user": p["lock_user"], "at": p["lock_at"]}


# ---------------------------------------------------------------- 카탈로그·구독
def catalog(user: dict, q: str = "") -> list[dict]:
    init()
    with storage.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM hub_projects ORDER BY name")]
    subs = {s["pid"] for s in subscriptions(user["username"])}
    out = []
    for p in rows:
        if not _can_read(user, p) or (q and q.lower() not in p["name"].lower()):
            continue
        s = latest(p["pid"])
        if not s:
            continue
        out.append({"pid": p["pid"], "name": p["name"], "owner": p["owner"], "version": s["version"], "data_date": s["data_date"], "finish": s["finish"],
                    "published_at": s["published_at"], "publisher": s["publisher"], "note": s["note"], "subscribed": p["pid"] in subs,
                    "mine": _can_write(user, p)})
    return out


def subscribe(user: dict, pid: str, on: bool = True) -> None:
    p = project(pid)
    if not p or not _can_read(user, p):
        raise HubError(404, "볼 수 없는 프로젝트입니다")
    with storage.conn() as c:
        if on:
            c.execute("INSERT OR IGNORE INTO hub_subs VALUES (?,?,?)", (user["username"], pid, _now()))
        else:
            c.execute("DELETE FROM hub_subs WHERE username=? AND pid=?", (user["username"], pid))


def subscriptions(username: str) -> list[dict]:
    init()
    with storage.conn() as c:
        return [dict(r) for r in c.execute("SELECT pid, created_at FROM hub_subs WHERE username=?", (username,))]


def subscribers(pid: str) -> list[dict]:
    with storage.conn() as c:
        return [dict(r) for r in c.execute("SELECT username FROM hub_subs WHERE pid=?", (pid,))]


def readable_snapshot(user: dict, pid: str, version: int | None = None) -> dict:
    p = project(pid)
    if not p or not _can_read(user, p):
        raise HubError(404, "볼 수 없는 프로젝트입니다")
    s = snapshot(pid, version)
    if not s:
        raise HubError(404, "게시된 판이 없습니다")
    return s


# ---------------------------------------------------------------- 공유 코드
def make_code(user: dict, pid: str, version: int | None, days: int = 7, max_uses: int | None = None, target: str | None = None) -> dict:
    p = project(pid)
    if not p:
        raise HubError(404, "먼저 PMS 대시보드에 게시하세요")
    if not _can_write(user, p):
        raise HubError(403, "프로젝트 소유자·멤버만 공유 코드를 만들 수 있습니다")
    if version is not None and not snapshot(pid, version):
        raise HubError(404, "없는 판입니다")
    days = max(1, min(int(days or 7), 30))
    raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
    code = f"PMS-{raw[:4]}-{raw[4:]}"
    exp = (datetime.now() + timedelta(days=days)).isoformat(timespec="seconds")
    with storage.conn() as c:
        c.execute("INSERT INTO hub_codes VALUES (?,?,?,?,?,?,0,0,?,?)", (code, pid, version, target or None, exp, max_uses, user["username"], _now()))
    storage.audit(user["username"], "POST", "/hub/v1/share-codes", 200, f"{code} {p['name']} v{version or '최신'}")
    return {"code": code, "expires_at": exp, "max_uses": max_uses, "version": version, "target": target}


def redeem(user: dict, code: str) -> dict:
    code = (code or "").strip().upper()
    with storage.conn() as c:
        r = c.execute("SELECT * FROM hub_codes WHERE code=?", (code,)).fetchone()
        if not r or r["revoked"]:
            raise HubError(404, "없거나 취소된 공유 코드입니다")
        if r["expires_at"] < _now():
            raise HubError(410, "만료된 공유 코드입니다")
        if r["max_uses"] and r["uses"] >= r["max_uses"]:
            raise HubError(410, "사용 횟수를 다 쓴 공유 코드입니다")
        if r["target_user"] and r["target_user"] != user["username"]:
            raise HubError(403, "다른 사용자에게 보낸 공유 코드입니다")
        c.execute("UPDATE hub_codes SET uses=uses+1 WHERE code=?", (code,))
    s = snapshot(r["pid"], r["version"])
    if not s:
        raise HubError(404, "게시된 판이 없습니다")
    storage.audit(user["username"], "GET", "/hub/v1/share-codes", 200, f"{code} 사용")
    return s


def codes(pid: str) -> list[dict]:
    with storage.conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM hub_codes WHERE pid=? ORDER BY created_at DESC", (pid,))]


def revoke_code(user: dict, code: str) -> None:
    with storage.conn() as c:
        r = c.execute("SELECT pid FROM hub_codes WHERE code=?", (code,)).fetchone()
        if not r:
            raise HubError(404, "없는 코드입니다")
        p = project(r["pid"])
        if not _can_write(user, p):
            raise HubError(403, "권한이 없습니다")
        c.execute("UPDATE hub_codes SET revoked=1 WHERE code=?", (code,))


# ---------------------------------------------------------------- 게시 현황 (대시보드용)
def publish_status() -> list[dict]:
    init()
    month = datetime.now().strftime("%Y-%m")
    out = []
    with storage.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM hub_projects ORDER BY name")]
    for p in rows:
        s = latest(p["pid"])
        out.append({"pid": p["pid"], "name": p["name"], "owner": p["owner"], "version": s["version"] if s else 0,
                    "published_at": s["published_at"] if s else None, "publisher": s["publisher"] if s else None,
                    "upload_id": s["upload_id"] if s else None, "this_month": bool(s and s["published_at"][:7] == month),
                    "lock_user": p["lock_user"]})
    return out


def snapshots_of(pid: str) -> list[dict]:
    with storage.conn() as c:
        return [dict(r) for r in c.execute("SELECT pid, version, upload_id, publisher, published_at, note, data_date, finish, size FROM hub_snapshots WHERE pid=? ORDER BY version DESC", (pid,))]


def to_json(x) -> str:
    return json.dumps(x, ensure_ascii=False)
