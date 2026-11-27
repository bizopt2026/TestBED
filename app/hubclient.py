"""PMS 현장 → PMS 대시보드 연결 (게시·카탈로그·구독·공유 코드·AI 게이트웨이).

브라우저는 자기 PMS 현장 서버만 부르고, PMS 현장 서버가 대시보드의 /hub/v1 API를 대신 부른다(CORS·토큰 노출 없음).
연결 정보: 대시보드 주소(PMS_HUB_URL 또는 내 설정), 사용자별 기기 토큰(비밀번호는 저장하지 않음).
"""
from __future__ import annotations

import json
import os
import platform
import urllib.error
import urllib.parse
import urllib.request

from . import edition, storage

TIMEOUT = int(os.environ.get("PMS_HUB_TIMEOUT", "30"))


class HubClientError(Exception):
    def __init__(self, status: int, message: str, extra: dict | None = None):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra or {}


def url() -> str:
    return (storage.setting("*", "hub_url") or edition.HUB_URL or "").rstrip("/")


def token(user: str) -> str | None:
    return storage.setting("*", f"hub_token:{user or '익명'}")


def connected(user: str) -> bool:
    return bool(url() and token(user))


def _opener():
    if os.environ.get("PMS_HUB_USE_PROXY") == "1":
        return urllib.request.build_opener()
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 사내망 대시보드는 프록시를 거치지 않음


def call(method: str, path: str, user: str, body=None, raw: bytes | None = None, headers: dict | None = None,
         timeout: int = TIMEOUT, base: str | None = None, auth: bool = True) -> tuple[int, dict, bytes]:
    base = (base or url()).rstrip("/")
    if not base:
        raise HubClientError(400, "PMS 대시보드 주소가 설정되지 않았습니다. 내 설정 → PMS 대시보드 연결에서 설정하세요")
    h = {"Accept": "application/json", **(headers or {})}
    data = raw
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode()
        h["Content-Type"] = "application/json"
    if auth:
        t = token(user)
        if not t:
            raise HubClientError(401, "PMS 대시보드에 연결되어 있지 않습니다. 내 설정에서 연결하세요")
        h["X-PMS-Device"] = t
    req = urllib.request.Request(base + path, data=data, method=method, headers=h)
    try:
        with _opener().open(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        try:
            d = json.loads(e.read() or b"{}").get("detail")
        except ValueError:
            d = None
        msg = d.get("message") if isinstance(d, dict) else d
        raise HubClientError(e.code, msg or f"PMS 대시보드 오류 ({e.code})", d if isinstance(d, dict) else {})
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise HubClientError(0, f"PMS 대시보드({base})에 연결할 수 없습니다: {getattr(e, 'reason', e)}")


def call_json(method: str, path: str, user: str, body=None, **kw):
    _, _, b = call(method, path, user, body=body, **kw)
    return json.loads(b or b"null")


# ---------------------------------------------------------------- 연결
def connect(user: str, base: str, username: str, password: str) -> dict:
    base = (base or "").strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        raise HubClientError(400, "주소는 http:// 또는 https:// 로 시작해야 합니다 (예: http://pms-server:8100)")
    cfg = call_json("GET", "/api/config", user, base=base, auth=False)
    if cfg.get("edition") != "server":
        raise HubClientError(400, "이 주소는 PMS 대시보드가 아닙니다")
    r = call_json("POST", "/hub/v1/devices", user, {"username": username, "password": password, "name": f"{platform.node() or 'PC'} · PMS 현장"}, base=base, auth=False)
    storage.set_setting("*", "hub_url", base, user)
    storage.set_setting("*", f"hub_token:{user or '익명'}", r["token"], user)
    return {"url": base, "hub_user": r["username"], "hub_name": cfg.get("edition_name"), "hub_version": cfg.get("version")}


def disconnect(user: str) -> None:
    storage.set_setting("*", f"hub_token:{user or '익명'}", None, user)


def status(user: str) -> dict:
    out = {"url": url(), "connected": connected(user), "hub_user": None, "error": None}
    if out["connected"]:
        try:
            me = call_json("GET", "/hub/v1/me", user, timeout=8)
            out["hub_user"] = me["username"]
        except HubClientError as e:
            out["error"] = e.message
            out["connected"] = e.status not in (401, 403)
    return out


# ---------------------------------------------------------------- 게시·구독·공유 코드
def publish(user: str, uid: str, note: str = "", take: bool = False) -> dict:
    from . import package
    data, m = package.build(uid, user, attachments=True)
    q = urllib.parse.urlencode({"note": note[:500], "take": "1" if take else "0"})
    r = json.loads(call("POST", f"/hub/v1/projects/{m['pid']}/snapshots?{q}", user, raw=data,
                        headers={"Content-Type": "application/zip"}, timeout=120)[2])
    name = storage.name_of(uid)
    storage.set_setting(name, "hub_published", {"pid": m["pid"], "version": r["version"], "upload_id": uid, "at": __import__("datetime").datetime.now().isoformat(timespec="seconds"), "by": user}, user)
    return r


def pull(user: str, pid: str, version: int | None = None, source: str = "hub", code: str | None = None) -> dict:
    """대시보드에서 판을 받아 참조 프로젝트로 가져온다."""
    from . import package
    path = f"/hub/v1/share-codes/{urllib.parse.quote(code)}" if code else f"/hub/v1/projects/{pid}/snapshots/{version or 'latest'}"
    _, h, data = call("GET", path, user, timeout=120)
    return package.import_package(data, user, source, {"hub_url": url(), "hub_version": int(h.get("X-PMS-Version") or 0)})


def sync(user: str) -> dict:
    """구독한 프로젝트의 새 판을 받아 온다."""
    from . import package
    subs = call_json("GET", "/hub/v1/subscriptions", user)
    have = {}
    for p in storage.latest_by_project():
        m = package.ref_meta(p["name"]) or {}
        if m.get("pid"):
            have[m["pid"]] = m.get("version") or 0
    updated = []
    for s in subs:
        if s.get("version", 0) > have.get(s["pid"], 0):
            r = pull(user, s["pid"])
            if not r.get("duplicate"):
                updated.append(r)
    return {"checked": len(subs), "updated": updated}


# ---------------------------------------------------------------- AI 게이트웨이 (PMS_AI_MODE=server)
def ai_complete(user: str, payload: dict) -> dict:
    return call_json("POST", "/hub/v1/ai/run", user, payload, timeout=600)
