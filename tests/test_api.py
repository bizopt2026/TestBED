import os
import tempfile

os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "t.db")

from fastapi.testclient import TestClient  # noqa: E402

from app import services, storage  # noqa: E402
from app.main import app  # noqa: E402
import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    # 다른 테스트가 바꾼 DB(사용자 계정 포함)를 쓰지 않도록 테스트마다 새 DB
    storage.DB_PATH = os.path.join(tempfile.mkdtemp(), "api.db")
    storage.init()
    services._tables.cache_clear()

SAMPLE = os.path.join(os.path.dirname(__file__), "..", "samples", "sample_project.xer")


def test_upload_list_get_delete():
    c = TestClient(app)
    with open(SAMPLE, "rb") as f:
        r = c.post("/api/upload", files={"file": ("s.xer", f)}, data={"uploader": "홍길동"})
    assert r.status_code == 200, r.text
    uid = r.json()["ids"][0]
    assert c.get("/api/uploads").json()[0]["uploader"] == "홍길동"
    d = c.get(f"/api/uploads/{uid}").json()
    assert d["result"]["summary"]["activities"] == 25
    assert c.get(f"/api/uploads/{uid}/activities.csv").status_code == 200
    cmp = c.get(f"/api/compare?base={uid}&target={uid}").json()
    assert cmp["finish_slip"] == 0
    assert c.delete(f"/api/uploads/{uid}").status_code == 200


def test_bad_file():
    c = TestClient(app)
    r = c.post("/api/upload", files={"file": ("x.xer", b"hello world")})
    assert r.status_code == 400
