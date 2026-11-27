import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import ai, services, storage  # noqa: E402
from app.main import app  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
SAMPLE = os.path.join(ROOT, "samples", "sample_project.xer")


@pytest.fixture
def client():
    storage.DB_PATH = os.path.join(tempfile.mkdtemp(), "u.db")
    storage.init()
    services._tables.cache_clear()
    ai.PROVIDER = "off"
    yield TestClient(app)
    ai.PROVIDER = "cli"


def up(c, raw):
    r = c.post("/api/upload", files={"file": ("s.xer", raw)}, data={"uploader": "t"})
    assert r.status_code == 200, r.text
    return r.json()["ids"][0]


def test_learn_sample_and_progress(client):
    uid = client.post("/api/learn/sample").json()["id"]
    assert client.post("/api/learn/sample").json()["id"] == uid  # 중복 생성 안 함
    d = client.get(f"/api/uploads/{uid}").json()
    assert d["name"] == services.LEARN_SAMPLE_NAME
    assert client.get(f"/api/uploads/{uid}/baselines").json() and client.get(f"/api/uploads/{uid}/risks").json()
    assert client.get(f"/api/uploads/{uid}/analysis" if False else f"/api/uploads/{uid}/forensic").json()["available"]
    assert client.get("/api/learn/progress?client_id=abc").json() == {}
    client.put("/api/learn/progress?client_id=abc", json={"data": {"done": ["start-1"], "quiz": {"start-1:1": True}}})
    assert client.get("/api/learn/progress?client_id=abc").json()["done"] == ["start-1"]
    assert client.get("/api/learn/progress?client_id=other").json() == {}
    team = client.get("/api/admin/learn").json()
    assert team[0]["lessons_done"] == 1
    assert client.put("/api/learn/progress", json={"data": {"x": "y" * 30000}}).status_code == 400


def test_inbox_items(client):
    raw = open(SAMPLE, "rb").read()
    up(client, raw)
    uid = up(client, raw.decode().replace("\t2026-03-02 08:00\tY", "\t2026-04-01 08:00\tY").encode())
    client.post(f"/api/uploads/{uid}/records/constraint", json={"code": "A1050", "type": "자재", "desc": "철근", "due": "2026-01-01"})
    items = client.get("/api/inbox").json()
    texts = " ".join(i["text"] for i in items)
    assert "준공 30일 지연" in texts and "기한 지난 제약" in texts
    assert items[0]["level"] == "high"


def test_saved_views(client):
    uid = up(client, open(SAMPLE, "rb").read())
    vid = client.post(f"/api/uploads/{uid}/views", json={"name": "골조 주공정", "config": {"q": "철골", "crit": True}}).json()["id"]
    assert client.get(f"/api/uploads/{uid}/views").json()[0]["config"]["q"] == "철골"
    assert client.post(f"/api/uploads/{uid}/views", json={"name": "", "config": {}}).status_code == 400
    assert client.delete(f"/api/uploads/{uid}/views/{vid}").status_code == 200


def test_photo_upload_validates_type(client):
    uid = up(client, open(SAMPLE, "rb").read())
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    r = client.post(f"/api/uploads/{uid}/photos", data={"ref": "A1050"}, files={"file": ("a.png", png)})
    assert r.status_code == 200
    fid = r.json()["id"]
    g = client.get(f"/api/photos/{fid}")
    assert g.headers["content-type"] == "image/png" and g.headers["x-content-type-options"] == "nosniff"
    html = b"<html><script>alert(1)</script>"
    assert client.post(f"/api/uploads/{uid}/photos", data={"ref": "A1050"}, files={"file": ("a.png", html)}).status_code == 400
    assert client.post(f"/api/uploads/{uid}/photos", data={"ref": "x"}, files={"file": ("a.jpg", b"\xff\xd8\xff" + b"0" * (3 * 1024 * 1024))}).status_code == 413


def test_static_pages_served(client):
    for f in ("app.js", "ui.js", "field.js", "learn.js", "style.css"):
        assert client.get(f"/static/{f}").status_code == 200
    assert "learn.js" in client.get("/").text
