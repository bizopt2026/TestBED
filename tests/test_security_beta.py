"""클로즈드 테스트(보안)에서 나온 결함의 회귀 테스트."""
import io
import json
import os
import tempfile
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import access, auth, package, services, storage
from app.main import app

PW = "beta-pass-42!"
RAW = open(os.path.join(os.path.dirname(__file__), "..", "samples", "sample_project.xer"), "rb").read()


@pytest.fixture()
def env():
    storage.DB_PATH = os.path.join(tempfile.mkdtemp(), "t.db")
    storage.init(); access.init(); services._tables.cache_clear()
    for u, r in (("admin", "admin"), ("alice", "editor"), ("bob", "editor"), ("vic", "viewer")):
        auth.create_user(u, PW, r)
    auth._fails.clear()
    yield


def login(u):
    c = TestClient(app); c.headers.update({"X-Requested-With": "fetch"})
    assert c.post("/api/login", json={"username": u, "password": PW}).status_code == 200
    return c


def _pkg(records: dict, xer: bytes = RAW, pid: str = "f" * 32) -> bytes:
    import hashlib
    files = {"schedule.xer": xer, "records.json": json.dumps(records).encode(), "settings.json": b"{}", "summary.json": b"{}"}
    man = {"format": package.FORMAT, "format_version": 1, "pid": pid, "project": "Thief", "files": {k: hashlib.sha256(v).hexdigest() for k, v in files.items()}}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("manifest.json", json.dumps(man))
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()


def test_import_cannot_hijack_other_project_records(env):
    bob, alice = login("bob"), login("alice")
    uid = bob.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    rid = bob.post(f"/api/uploads/{uid}/risks", json={"title": "bob 리스크", "codes": [], "prob": 30}).json()["id"]
    storage.set_setting(storage.name_of(uid), "pid", "a" * 32)   # 다른 pid 라 가져오기는 허용됨
    r = alice.post("/api/import/pms", files={"file": ("x.pms", _pkg({"risk": [{"id": rid, "title": "STOLEN"}]}))})
    assert r.status_code == 200, r.text
    assert [x["title"] for x in bob.get(f"/api/uploads/{uid}/risks").json()] == ["bob 리스크"]
    assert storage.rec_scope("risk", rid) == storage.name_of(uid)


def test_viewer_cannot_publish_to_hub(env):
    from app import hub
    with pytest.raises(hub.HubError) as e:
        hub.publish({"username": "vic", "role": "viewer"}, "dev", _pkg({}), "")
    assert e.value.status == 403


def test_zip_bomb_rejected(env, monkeypatch):
    monkeypatch.setattr(package, "MAX_UNPACKED", 1024 * 1024)
    big = _pkg({"comment": [{"id": "z", "text": "x" * 2_000_000}]})
    with pytest.raises(package.PackageError):
        package.read(big)


def test_bad_inputs_are_400_not_500(env):
    a = login("alice")
    uid = a.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    assert a.post(f"/api/uploads/{uid}/recovery", json={"days": "abc"}).status_code == 400
    assert a.post(f"/api/uploads/{uid}/whatif", json={"changes": "nope"}).status_code == 400
    assert a.put(f"/api/uploads/{uid}/settings", json={"weather_days": {"x": 1}}).status_code == 400
    bad = _pkg({}, xer=b"not an xer at all")
    assert a.post("/api/import/pms", files={"file": ("x.pms", bad)}).status_code == 400


def test_password_policy_and_ip_lockout(env):
    for pw in ("1234567890", "aaaaaaaaaa", "abcdefghijk"):
        with pytest.raises(ValueError):
            auth.validate_pw(pw)
    auth.validate_pw("site-pass-2026")
    for _ in range(5):
        with pytest.raises(PermissionError):
            auth.login("alice", "wrong", ip="10.0.0.9")
    with pytest.raises(PermissionError, match="잠겼"):
        auth.login("alice", PW, ip="10.0.0.9")
    assert auth.login("alice", PW, ip="10.0.0.10")          # 다른 PC 에서는 로그인 가능 (남이 계정을 잠그지 못함)


def test_config_hides_commit_before_login(env):
    c = TestClient(app)
    assert "(" not in c.get("/api/config").json()["version"]


def test_config_has_today(env):
    assert TestClient(app).get("/api/config").json()["today"]
