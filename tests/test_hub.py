"""PMS P2: PMS 대시보드(별도 프로세스) ↔ PMS 현장 — 연결·게시·편집 소유권·카탈로그·구독·동기화·공유 코드·AI 게이트웨이."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

import pytest
from fastapi.testclient import TestClient

from app import access, ai, edition, services, storage
from app.main import app

ROOT = os.path.join(os.path.dirname(__file__), "..")
RAW = open(os.path.join(ROOT, "samples", "sample_project.xer"), "rb").read()
PW = "hub-password-123"


def _free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


@pytest.fixture(scope="module")
def hub_server():
    port = _free_port()
    db = os.path.join(tempfile.mkdtemp(), "hub.db")
    env = {**os.environ, "DB_PATH": db, "PMS_EDITION": "server", "AI_PROVIDER": "cli", "CLAUDE_BIN": os.path.join(ROOT, "tests", "fake_claude_cli.py"), "PYTHONPATH": ROOT}
    subprocess.run([sys.executable, "-c", f"""from app import auth, storage, access
storage.init(); access.init()
for u, r in (("admin", "admin"), ("alice", "editor"), ("bob", "editor"), ("vic", "viewer")): auth.create_user(u, "{PW}", r)"""], cwd=ROOT, env=env, check=True)
    p = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port), "--log-level", "warning"], cwd=ROOT, env=env)
    url = f"http://127.0.0.1:{port}"
    for _ in range(80):
        try:
            urllib.request.urlopen(url + "/api/config", timeout=1); break
        except Exception:
            time.sleep(0.15)
    yield url
    p.terminate(); p.wait(5)


def _client_db():
    storage.DB_PATH = os.path.join(tempfile.mkdtemp(), "c.db")
    storage.init(); access.init(); services._tables.cache_clear()
    return storage.DB_PATH


def _use(db):
    storage.DB_PATH = db; services._tables.cache_clear()


def _c():
    c = TestClient(app); c.headers.update({"X-Requested-With": "fetch"}); return c


def _hub_session(url, user):
    """대시보드에 브라우저처럼 로그인 (관리 API 호출용)."""
    import http.cookiejar
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), urllib.request.ProxyHandler({}))
    op.open(urllib.request.Request(url + "/api/login", data=json.dumps({"username": user, "password": PW}).encode(), headers={"Content-Type": "application/json", "X-Requested-With": "fetch"}))
    def call(method, path, body=None):
        try:
            r = op.open(urllib.request.Request(url + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                               headers={"Content-Type": "application/json", "X-Requested-With": "fetch"}))
        except urllib.error.HTTPError as e:
            raise AssertionError(f"{method} {path} → {e.code} {e.read()[:300]!r}") from None
        return json.loads(r.read() or b"null")
    return call


def test_hub_end_to_end(hub_server, monkeypatch):
    monkeypatch.setattr(edition, "EDITION", "client")
    monkeypatch.setattr(ai, "PROVIDER", "cli")
    # ---- A: alice 의 PMS 현장
    db_a = _client_db(); a = _c()
    assert a.post("/api/hub/connect", json={"url": hub_server, "username": "alice", "password": "wrong"}).status_code == 400   # 401 이면 현장 로그인 화면이 뜸
    assert a.post("/api/hub/connect", json={"url": hub_server, "username": "alice", "password": PW}).json()["hub_user"] == "alice"
    assert a.get("/api/hub/status").json()["connected"] is True
    uid = a.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    a.post(f"/api/uploads/{uid}/risks", json={"title": "철골 지연", "codes": ["A2000"], "prob": 30})
    r1 = a.post(f"/api/uploads/{uid}/publish", json={"note": "3월 업데이트"}).json()
    assert r1["version"] == 1
    assert a.post(f"/api/uploads/{uid}/publish", json={}).json()["version"] == 2
    info = a.get(f"/api/uploads/{uid}/hub").json()
    assert info["published"]["version"] == 2 and info["lock"]["user"] == "alice"
    pid = r1["pid"]
    # ---- 같은 계정의 다른 PC: 편집 소유권이 없으면 409, 가져오면 게시 가능
    db_a2 = _client_db(); a2 = _c()
    a2.post("/api/hub/connect", json={"url": hub_server, "username": "alice", "password": PW})
    _use(db_a); data = a.get(f"/api/uploads/{uid}/export.pms").content; _use(db_a2)
    req = urllib.request.Request(f"{hub_server}/hub/v1/projects/{pid}/snapshots", data=data, method="POST",
                                 headers={"X-PMS-Device": storage.setting("*", "hub_token:익명"), "Content-Type": "application/zip"})
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req)
    assert e.value.code == 409
    req.full_url = f"{hub_server}/hub/v1/projects/{pid}/snapshots?take=1"
    assert json.loads(urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req).read())["version"] == 3
    # ---- B: bob 의 PMS 현장 — 카탈로그·구독(참조 프로젝트)·동기화
    db_b = _client_db(); b = _c()
    b.post("/api/hub/connect", json={"url": hub_server, "username": "bob", "password": PW})
    cat = b.get("/api/hub/catalog").json()
    assert cat[0]["pid"] == pid and cat[0]["version"] == 3 and cat[0]["mine"] is False
    sub = b.post("/api/hub/subscribe", json={"pid": pid}).json()
    assert sub["version"] == 3 and sub["name"].endswith("· 참조")
    perm = b.get(f"/api/uploads/{sub['uid']}/perm").json()
    assert perm["can_write"] is False and perm["ref"]["source"] == "hub"
    assert [x["title"] for x in b.get(f"/api/uploads/{sub['uid']}/risks").json()] == ["철골 지연"]
    assert b.post(f"/api/uploads/{sub['uid']}/publish", json={}).status_code == 403          # 참조는 게시 불가
    assert b.post("/api/hub/sync").json()["updated"] == []
    _use(db_a); assert a.post(f"/api/uploads/{uid}/publish", json={"take": True}).json()["version"] == 4
    _use(db_b); s2 = b.post("/api/hub/sync").json()
    assert [x["version"] for x in s2["updated"]] == [4]
    # ---- 공유 코드: alice 가 만들고 vic(조회 전용)이 받음
    _use(db_a); code = a.post(f"/api/uploads/{uid}/share-code", json={"days": 3, "max_uses": 1}).json()["code"]
    assert code.startswith("PMS-")
    db_v = _client_db(); v = _c()
    v.post("/api/hub/connect", json={"url": hub_server, "username": "vic", "password": PW})
    got = v.post("/api/hub/redeem", json={"code": code.lower()}).json()
    assert got["version"] == 4 and v.get(f"/api/uploads/{got['uid']}/perm").json()["ref"]["source"] == "code"
    assert v.post("/api/hub/redeem", json={"code": code}).status_code == 410                 # 사용 횟수 소진
    # ---- P4: 구독자(bob)가 참조 프로젝트에 남긴 코멘트가 대시보드를 거쳐 소유자(alice) 현장에 보임 + 대시보드 이슈
    _use(db_b)
    assert b.post(f"/api/uploads/{sub['uid']}/hub-comments", json={"text": "@alice 철골 반입 일정 확인 부탁"}).status_code == 200
    _use(db_a)
    feed = a.get(f"/api/uploads/{uid}/hub-feed").json()
    assert feed["available"] and any(c["author"] == "bob" and "철골" in c["text"] for c in feed["comments"])
    assert isinstance(feed["issues"], list)
    # ---- AI 게이트웨이: 현장 AI 는 서버에서 실행 (PMS_AI_MODE=server)
    _use(db_a)
    monkeypatch.setattr(edition, "HUB_URL", hub_server)
    st = a.get(f"/api/ai/status?uid={uid}").json()
    assert st["enabled"] is True and st["route"] == "gateway"
    w = a.post(f"/api/uploads/{uid}/why/ai", json={"key": "spi"}).json()
    assert w["text"].startswith("서버 게이트웨이 설명")
    chat = a.post(f"/api/uploads/{uid}/chat", json={"messages": [{"role": "user", "content": "주공정은?"}]}).json()
    assert chat["answer"] == "서버 게이트웨이 도구 답변"
    # 대시보드 관리자가 AI 금지 → 게이트웨이도 거절
    adm = _hub_session(hub_server, "admin")
    adm("PUT", "/api/admin/ai-policy", {"project": cat[0]["name"], "policy": "forbid"})
    r = a.post(f"/api/uploads/{uid}/chat", json={"messages": [{"role": "user", "content": "다시"}]})
    assert r.status_code in (400, 502) and "금지" in r.text
    # 대시보드 게시 현황
    ps = adm("GET", "/api/dashboard/publish-status")
    assert ps[0]["version"] == 4 and ps[0]["this_month"] is True
    assert any(d["username"] == "alice" for d in adm("GET", "/api/admin/hub/devices"))
    # ---- P5: 상태 확인·백업
    h = adm("GET", "/api/health")
    assert h["edition"] == "server" and h["hub_projects"] == 1 and h["devices"] >= 3
    import http.cookiejar  # noqa: F401
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with pytest.raises(urllib.error.HTTPError):
        op.open(hub_server + "/api/admin/backup")            # 로그인 없이 불가


def test_hub_records_two_way(hub_server, monkeypatch):
    """리스크·제약 양방향 동기화: 나중에 고친 쪽 우선, 지움도 전파, 밀린 내용은 기록·되살리기."""
    monkeypatch.setattr(edition, "EDITION", "client")
    db = _client_db(); a = _c()
    a.post("/api/hub/connect", json={"url": hub_server, "username": "alice", "password": PW})
    uid = a.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    name = storage.name_of(uid)
    r1 = a.post(f"/api/uploads/{uid}/risks", json={"title": "철골 지연", "codes": [], "prob": 30}).json()["id"]
    x = storage.rec_get("risk", r1); storage.rec_put("risk", name, x, "alice", rid=r1, updated_at="2026-01-01T00:00:00")
    pub = a.post(f"/api/uploads/{uid}/publish", json={}).json()
    huid = pub["upload_id"]
    hub = _hub_session(hub_server, "alice")
    assert [x["title"] for x in hub("GET", f"/api/uploads/{huid}/risks")] == ["철골 지연"]
    # 대시보드에서 고치고 새로 추가
    hub("POST", f"/api/uploads/{huid}/risks", {"id": r1, "title": "철골 지연(본사 확인)", "codes": [], "prob": 50})
    r2 = hub("POST", f"/api/uploads/{huid}/risks", {"title": "크레인 고장", "codes": [], "prob": 20})["id"]
    s = a.post("/api/hub/sync").json()
    assert s["records"] and s["records"][0]["local"]["added"] == 1 and s["records"][0]["local"]["updated"] == 1
    titles = {x["id"]: x["title"] for x in storage.rec_list("risk", name)}
    assert titles == {r1: "철골 지연(본사 확인)", r2: "크레인 고장"}
    log = a.get(f"/api/uploads/{uid}/sync-log").json()
    assert log[0]["action"] == "덮어씀" and log[0]["winner"] == "대시보드" and log[0]["lost"]["title"] == "철골 지연"
    # 현장이 더 나중에 고친 것은 현장 쪽이 이김 → 대시보드로 퍼짐
    x = storage.rec_get("risk", r2); storage.rec_put("risk", name, {**x, "title": "크레인 고장(수리 완료)"}, "alice", rid=r2, updated_at="2099-01-01T00:00:00")
    a.post("/api/hub/sync")
    assert {x["id"]: x["title"] for x in hub("GET", f"/api/uploads/{huid}/risks")}[r2] == "크레인 고장(수리 완료)"
    # 대시보드에서 지우면 현장에서도 지워짐 (나중에 고치지 않았으므로)
    time.sleep(1.1)   # 같은 초의 고침·지움은 '남기기'가 이기므로, 지움을 1초 뒤에
    hub("DELETE", f"/api/uploads/{huid}/risks/{r1}")
    a.post("/api/hub/sync")
    assert [x["id"] for x in storage.rec_list("risk", name)] == [r2]
    gone = next(x for x in a.get(f"/api/uploads/{uid}/sync-log").json() if x["action"] == "삭제됨")
    # 되살리기
    assert a.post(f"/api/uploads/{uid}/sync-log/{gone['id']}/restore").json()["ok"]
    assert {x["title"] for x in storage.rec_list("risk", name)} == {"철골 지연(본사 확인)", "크레인 고장(수리 완료)"}
    # 게시해도 대시보드에서만 추가한 것은 지워지지 않음
    r3 = hub("POST", f"/api/uploads/{huid}/risks", {"title": "우기 대비", "codes": [], "prob": 40})["id"]
    pub2 = a.post(f"/api/uploads/{uid}/publish", json={}).json()
    assert r3 in {x["id"] for x in hub("GET", f"/api/uploads/{pub2['upload_id']}/risks")}
    assert r3 in {x["id"] for x in storage.rec_list("risk", name)}        # 게시 전에 받아 왔음


def test_hub_beta_fixes(hub_server, monkeypatch):
    """클로즈드 테스트(협업)에서 나온 결함의 회귀 테스트."""
    from app import notify, recsync
    monkeypatch.setattr(edition, "EDITION", "client")
    db = _client_db(); a = _c()
    a.post("/api/hub/connect", json={"url": hub_server, "username": "bob", "password": PW})
    # 연결한 현장은 AI를 대시보드에서 실행 (PMS_HUB_URL 없이 내 설정으로 연결해도)
    monkeypatch.setattr(edition, "HUB_URL", "")
    assert edition.ai_route()[0] == "gateway"
    uid = a.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    name = storage.name_of(uid)
    assert a.post(f"/api/uploads/{uid}/publish", json={}).json()["version"] == 1
    # 같은 PC에서 다시 연결해도 편집 소유권 유지 (예전 토큰은 끊김)
    old = storage.setting("*", "hub_token:익명")
    a.post("/api/hub/connect", json={"url": hub_server, "username": "bob", "password": PW})
    assert storage.setting("*", "hub_token:익명") != old
    assert a.post(f"/api/uploads/{uid}/publish", json={}).json()["version"] == 2
    # 공유 코드 입력 검사
    assert a.post(f"/api/uploads/{uid}/share-code", json={"days": 0}).status_code == 400
    assert a.post(f"/api/uploads/{uid}/share-code", json={"days": 3, "max_uses": -1}).status_code == 400
    assert a.post(f"/api/uploads/{uid}/share-code", json={"days": 3, "target": "nobody"}).status_code == 400
    code = a.post(f"/api/uploads/{uid}/share-code", json={"days": 3}).json()["code"]
    assert any(c["code"] == code for c in a.get(f"/api/uploads/{uid}/share-codes").json())
    assert a.post(f"/api/uploads/{uid}/share-codes/{code.lower()}/revoke").status_code == 200
    # 휴지통에서 되돌린 리스크는 다음 동기화에서 다시 지워지지 않음
    rid = a.post(f"/api/uploads/{uid}/risks", json={"title": "되돌림 확인", "codes": [], "prob": 30}).json()["id"]
    a.post("/api/hub/sync")
    tid = a.delete(f"/api/uploads/{uid}/risks/{rid}").json()["trash_id"]
    a.post("/api/hub/sync")
    notify.restore(tid)
    a.post("/api/hub/sync")
    assert rid in {x["id"] for x in storage.rec_list("risk", name)}
    # 같은 초에 양쪽에서 고쳐도 같은 쪽으로 맞춰짐
    x = storage.rec_get("risk", rid)
    mine = {**x, "title": "현장 동시", "updated_at": "2099-01-01T00:00:00", "id": rid}
    theirs = {**x, "title": "본사 동시", "updated_at": "2099-01-01T00:00:00", "id": rid}
    storage.rec_put("risk", name, mine, "bob", rid=rid, updated_at="2099-01-01T00:00:00")
    recsync.merge(name, {"risk": [theirs]}, "대시보드")
    t1 = storage.rec_get("risk", rid)["title"]
    storage.rec_put("risk", name, theirs, "bob", rid=rid, updated_at="2099-01-01T00:00:00")
    recsync.merge(name, {"risk": [mine]}, "현장")
    assert storage.rec_get("risk", rid)["title"] == t1
    # 대시보드 기기 연결이 끊기면 현장 로그인 화면(401)이 아니라 다시 연결 안내
    storage.set_setting("*", "hub_token:익명", "revoked-token")
    r = a.get(f"/api/uploads/{uid}/hub-feed")
    assert r.status_code != 401 and storage.setting("*", "hub_token:익명") is None
