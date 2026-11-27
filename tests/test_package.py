"""PMS P1: .pms 패키지 내보내기·가져오기(파일·붙여넣기), 참조 프로젝트(읽기 전용), 복제."""
import io
import os
import tempfile
import zipfile

from fastapi.testclient import TestClient

from tests.test_access import RAW, env, login  # noqa: F401

from app import access, services, storage
from app.main import app


def _fresh_client_db():
    storage.DB_PATH = os.path.join(tempfile.mkdtemp(), "b.db")
    storage.init(); access.init(); services._tables.cache_clear()


def test_export_import_roundtrip(env):
    alice = login("alice")
    uid = alice.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    name = alice.get(f"/api/uploads/{uid}").json()["name"]
    alice.post(f"/api/uploads/{uid}/risks", json={"title": "철골 지연", "codes": ["A2000"], "prob": 30})
    r = alice.get(f"/api/uploads/{uid}/export.pms")
    assert r.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert {"manifest.json", "schedule.xer", "records.json", "summary.json", "settings.json"} <= set(z.namelist())
    text = alice.get(f"/api/uploads/{uid}/export.txt").json()["text"]
    assert text.startswith("PMS1:")
    # 같은 PMS에는 원본이 있어 참조로 못 가져옴
    assert alice.post("/api/import/text", json={"text": text}).status_code == 400
    # 다른 사람 PC(새 DB, 계정 없음)로 가져오기
    _fresh_client_db()
    c = TestClient(app); c.headers.update({"X-Requested-With": "fetch"})
    res = c.post("/api/import/pms", files={"file": ("x.pms", r.content)}).json()
    assert res["name"] == name + " · 참조" and res["version"] == 1 and not res["duplicate"]
    assert c.post("/api/import/text", json={"text": text}).json()["duplicate"] is True     # 같은 판은 다시 만들지 않음
    ref_uid = res["uid"]
    perm = c.get(f"/api/uploads/{ref_uid}/perm").json()
    assert perm["can_write"] is False and perm["ref"]["project"] == name and perm["ref"]["source"] == "file"
    assert [x["title"] for x in c.get(f"/api/uploads/{ref_uid}/risks").json()] == ["철골 지연"]
    # 읽기 전용: 리스크 추가·재계산 불가, 내보내기는 가능
    assert c.post(f"/api/uploads/{ref_uid}/risks", json={"title": "x"}).status_code == 403
    assert c.post(f"/api/uploads/{ref_uid}/recalc").status_code == 403
    assert c.get(f"/api/uploads/{ref_uid}/export.pms").status_code == 200
    # 복제하면 내 프로젝트(편집 가능)
    cl = c.post(f"/api/projects/{res['name']}/clone", json={"name": "내 물류센터"}).json()
    assert c.get(f"/api/uploads/{cl['uid']}/perm").json()["can_write"] is True
    assert c.get(f"/api/uploads/{cl['uid']}").json()["result"]["name"] == "내 물류센터"
    assert c.post(f"/api/uploads/{cl['uid']}/recalc").status_code == 200           # 다시 계산해도 이름 유지
    assert c.get(f"/api/uploads/{cl['uid']}").json()["result"]["name"] == "내 물류센터"
    assert [x["title"] for x in c.get(f"/api/uploads/{cl['uid']}/risks").json()] == ["철골 지연"]
    assert c.post(f"/api/projects/{res['name']}/clone", json={"name": "내 물류센터"}).status_code == 400


def test_bad_packages(env):
    alice = login("alice")
    assert alice.post("/api/import/text", json={"text": "hello"}).status_code == 400
    assert alice.post("/api/import/pms", files={"file": ("x.pms", b"not a zip")}).status_code == 400
    uid = alice.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    data = alice.get(f"/api/uploads/{uid}/export.pms").content
    z = zipfile.ZipFile(io.BytesIO(data)); buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as w:
        for n in z.namelist():
            w.writestr(n, z.read(n) + (b" " if n == "schedule.xer" else b""))
    r = alice.post("/api/import/pms", files={"file": ("x.pms", buf.getvalue())})
    assert r.status_code == 400 and "해시" in r.json()["detail"]
