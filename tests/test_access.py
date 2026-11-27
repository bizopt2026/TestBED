import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import access, ai, auth, services, storage  # noqa: E402
from app.main import app  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
RAW = open(os.path.join(ROOT, "samples", "sample_project.xer"), "rb").read()
H = {"X-Requested-With": "fetch"}
PW = "correct-horse-9"


@pytest.fixture
def env():
    storage.DB_PATH = os.path.join(tempfile.mkdtemp(), "a.db")
    storage.init()
    access.init()
    services._tables.cache_clear()
    ai.PROVIDER = "off"
    legacy = TestClient(app).post("/api/upload", files={"file": ("old.xer", RAW.replace(b"SAMPLE-", b"LEGACY-"))},
                                  data={"uploader": "alice"}).json()["ids"][0]   # 계정 도입 전 업로드
    for u, r in (("admin", "admin"), ("alice", "editor"), ("bob", "editor"), ("vic", "viewer")):
        auth.create_user(u, PW, r)
    yield legacy
    ai.PROVIDER = "cli"


def login(name):
    c = TestClient(app)
    assert c.post("/api/login", json={"username": name, "password": PW}).status_code == 200
    c.headers.update(H)
    return c


def test_read_all_write_own(env):
    alice, bob, vic, adm = login("alice"), login("bob"), login("vic"), login("admin")
    uid = alice.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    name = alice.get(f"/api/uploads/{uid}").json()["name"]
    assert access.members(name)[0] == {**access.members(name)[0], "username": "alice", "role": "owner"}
    # 읽기: 누구나
    for c in (bob, vic):
        d = c.get(f"/api/uploads/{uid}").json()
        assert d["result"]["name"] == name and d["can_write"] is False
        assert c.post(f"/api/uploads/{uid}/whatif", json={"changes": []}).status_code == 200
    # 쓰기: 소유자만
    risk = {"title": "철골 지연", "codes": ["A2000"], "prob": 30}
    assert alice.post(f"/api/uploads/{uid}/risks", json=risk).status_code == 200
    r = bob.post(f"/api/uploads/{uid}/risks", json=risk)
    assert r.status_code == 403 and "쓰기 권한" in r.json()["detail"]
    assert vic.post(f"/api/uploads/{uid}/risks", json=risk).status_code == 403
    assert bob.put(f"/api/uploads/{uid}/settings", json={"weather_days": {"7": 5}}).status_code == 403
    assert bob.post(f"/api/uploads/{uid}/recalc").status_code == 403
    assert bob.post("/api/upload", files={"file": ("p2.xer", RAW)}).status_code == 403   # 남의 프로젝트 업데이트 불가
    assert bob.post(f"/api/uploads/{uid}/xer_patch", json={"changes": []}).status_code == 200  # 다운로드는 가능
    # 관리자는 모두 가능
    assert adm.post(f"/api/uploads/{uid}/risks", json=risk).status_code == 200
    # 소유자가 bob 을 멤버로 추가 → 쓰기 가능, 멤버는 멤버 관리·업로드 삭제 불가
    assert bob.post(f"/api/projects/{name}/members", json={"username": "bob", "role": "member"}).status_code == 403
    assert alice.post(f"/api/projects/{name}/members", json={"username": "bob", "role": "member"}).status_code == 200
    assert bob.post(f"/api/uploads/{uid}/risks", json=risk).status_code == 200
    assert bob.post("/api/upload", files={"file": ("p2.xer", RAW)}).status_code == 200
    assert bob.delete(f"/api/uploads/{uid}").status_code == 403
    assert alice.post(f"/api/projects/{name}/members", json={"username": "nobody"}).status_code == 400
    # 마지막 소유자 제거 불가, 멤버 제거 후 다시 쓰기 불가
    assert alice.delete(f"/api/projects/{name}/members/alice").status_code == 400
    assert alice.delete(f"/api/projects/{name}/members/bob").status_code == 200
    assert bob.post(f"/api/uploads/{uid}/risks", json=risk).status_code == 403
    # 시나리오·사진 삭제도 프로젝트 권한으로 검사
    sid = alice.post(f"/api/uploads/{uid}/scenarios", json={"name": "s", "changes": []}).json()["id"]
    assert bob.delete(f"/api/scenarios/{sid}").status_code == 403
    assert alice.delete(f"/api/scenarios/{sid}").status_code == 200
    # 새 프로젝트는 bob 이 만들면 bob 소유
    uid2 = bob.post("/api/upload", files={"file": ("n.xer", RAW.replace(b"SAMPLE-", b"BOB-"))}).json()["ids"][0]
    assert bob.get(f"/api/uploads/{uid2}").json()["my_role"] == "owner"
    assert alice.post(f"/api/uploads/{uid2}/risks", json=risk).status_code == 403
    # 거부 기록은 감사 로그에
    assert any(a["status"] == 403 and "프로젝트 권한 없음" in (a["detail"] or "") for a in adm.get("/api/admin/audit").json())
    # 목록 API
    ps = {p["name"]: p for p in bob.get("/api/projects").json()}
    assert ps[name]["can_write"] is False and ps["BOB-물류센터 신축공사"]["my_role"] == "owner"


def test_legacy_project_and_viewer(env):
    alice, bob, vic = login("alice"), login("bob"), login("vic")
    # 계정 도입 전 업로드: 업로더 이름과 같은 계정(alice)이 자동으로 소유자
    assert alice.post(f"/api/uploads/{env}/risks", json={"title": "x"}).status_code == 200
    assert bob.post(f"/api/uploads/{env}/risks", json={"title": "x"}).status_code == 403
    # viewer 는 새 프로젝트도 만들 수 없음
    assert vic.post("/api/upload", files={"file": ("v.xer", RAW.replace(b"SAMPLE-", b"VIC-"))}).status_code == 403
    # 교육용 샘플은 편집 권한자 누구나 실습 가능
    s = bob.post("/api/learn/sample").json()["id"]
    assert bob.post(f"/api/uploads/{s}/risks", json={"title": "실습"}).status_code == 200


def test_change_own_password(env):
    vic = login("vic")
    assert vic.post("/api/me/password", json={"current": "wrong", "new": "another-pass-1"}).status_code == 400
    assert vic.post("/api/me/password", json={"current": PW, "new": "short"}).status_code == 400
    assert vic.post("/api/me/password", json={"current": PW, "new": "another-pass-1"}).status_code == 200
    assert vic.get("/api/uploads").status_code == 401            # 세션 무효화 → 다시 로그인
    assert TestClient(app).post("/api/login", json={"username": "vic", "password": "another-pass-1"}).status_code == 200
