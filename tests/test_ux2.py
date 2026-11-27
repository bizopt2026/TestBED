import io
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))

import openpyxl  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import access, ai, auth, notify, services, storage  # noqa: E402
from app.main import app  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
RAW = open(os.path.join(ROOT, "samples", "sample_project.xer"), "rb").read()
RAW2 = RAW.decode().replace("\t2026-03-02 08:00\tY", "\t2026-04-01 08:00\tY").encode()
PW = "correct-horse-9"
H = {"X-Requested-With": "fetch"}


@pytest.fixture
def db():
    storage.DB_PATH = os.path.join(tempfile.mkdtemp(), "x.db")
    storage.init(); access.init(); notify.init()
    services._tables.cache_clear()
    ai.PROVIDER = "off"
    yield
    ai.PROVIDER = "cli"


def two(c):
    a = c.post("/api/upload", files={"file": ("a.xer", RAW)}).json()["ids"][0]
    b = c.post("/api/upload", files={"file": ("b.xer", RAW2)}).json()["ids"][0]
    return a, b


def test_situation_readiness_review(db):
    c = TestClient(app)
    a, b = two(c)
    s = c.get(f"/api/uploads/{b}/situation").json()
    assert "직전 대비 +30일" in s["headline"] and "A2000" in s["headline"]
    k = {x["key"]: x for x in s["kpis"]}
    assert k["finish"]["delta"] == 30 and len(k["progress"]["series"]) == 2
    assert s["todo"] and s["base_data_date"] == "2026-03-02"
    rd = {x["key"]: x for x in c.get(f"/api/uploads/{b}/readiness").json()}
    assert rd["history"]["ok"] and rd["cost"]["ok"] and rd["must_finish"]["ok"]
    rd1 = {x["key"]: x for x in c.get(f"/api/uploads/{a}/readiness").json()}
    assert rd1["history"]["ok"] is False and rd1["history"]["fix"]
    rv = c.get(f"/api/uploads/{b}/review").json()
    steps = {x["key"]: x for x in rv["steps"]}
    assert [x["key"] for x in rv["steps"]] == ["import", "changes", "health", "delay", "baseline", "report"]
    assert steps["delay"]["ok"] is False and "+30일" in steps["delay"]["summary"]
    # 비교 기준을 자기 자신으로 → 지연 0
    assert "직전과 같음" in c.get(f"/api/uploads/{b}/situation?base={b}").json()["headline"]


def test_trash_restore(db):
    c = TestClient(app)
    a, b = two(c)
    rid = c.post(f"/api/uploads/{b}/risks", json={"title": "삭제 시험", "codes": ["A2000"], "prob": 20}).json()["id"]
    t = c.delete(f"/api/uploads/{b}/risks/{rid}").json()["trash_id"]
    assert not c.get(f"/api/uploads/{b}/risks").json()
    assert c.post(f"/api/trash/{t}/restore").json()["kind"] == "record"
    assert c.get(f"/api/uploads/{b}/risks").json()[0]["title"] == "삭제 시험"
    t2 = c.delete(f"/api/uploads/{a}").json()["trash_id"]
    assert c.get(f"/api/uploads/{a}").status_code == 404
    c.post(f"/api/trash/{t2}/restore")
    assert c.get(f"/api/uploads/{a}").json()["result"]["data_date"] == "2026-03-02"
    assert c.post(f"/api/trash/{t2}/restore").status_code == 404


def test_access_request_and_notifications(db):
    for u, r in (("own", "editor"), ("req", "editor"), ("adm", "admin")):
        auth.create_user(u, PW, r)

    def login(n):
        x = TestClient(app); x.post("/api/login", json={"username": n, "password": PW}); x.headers.update(H); return x
    own, req = login("own"), login("req")
    uid = own.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    name = own.get(f"/api/uploads/{uid}").json()["name"]
    assert req.post(f"/api/projects/{name}/access-request", json={"message": "리스크 입력 담당"}).status_code == 200
    n = own.get("/api/notifications").json()
    assert n["unread"] == 1 and "편집 권한을 요청" in n["items"][0]["text"]
    assert req.get(f"/api/projects/{name}/access-requests").status_code == 403
    rq = own.get(f"/api/projects/{name}/access-requests").json()[0]
    own.post(f"/api/projects/{name}/access-requests/{rq['id']}", json={"approve": True})
    assert "승인" in req.get("/api/notifications").json()["items"][0]["text"]
    assert req.post(f"/api/uploads/{uid}/risks", json={"title": "x"}).status_code == 200
    # 새 업데이트 알림 (올린 사람 제외)
    req.post("/api/upload", files={"file": ("p2.xer", RAW2)})
    assert any("새 업데이트" in i["text"] for i in own.get("/api/notifications").json()["items"])
    own.post("/api/notifications/read", json={})
    assert own.get("/api/notifications").json()["unread"] == 0


def test_report_preview_versions_and_base(db):
    c = TestClient(app)
    a, b = two(c)
    tpl = c.get("/api/reports/templates").json()[0]["id"]
    pv = c.post("/api/reports/preview", json={"template_id": tpl, "upload_id": b}).json()
    names = [s["name"] for s in pv["sheets"]]
    assert "요약" in names and pv["sheets"][0]["rows"][3][1] == "2026-09-25"
    # 비교 기준 = 자기 자신 → 직전 대비 0
    res = c.post("/api/reports/render", json={"template_id": tpl, "upload_id": b, "base": b})
    assert openpyxl.load_workbook(io.BytesIO(res.content))["요약"]["D5"].value == 0
    # 같은 이름으로 다시 올리면 버전
    wb = openpyxl.Workbook(); wb.active["A1"] = "{{project.name}}"; buf = io.BytesIO(); wb.save(buf)
    t1 = c.post("/api/reports/templates", files={"file": ("v.xlsx", buf.getvalue())}, data={"name": "버전 양식"}).json()
    wb.active["A2"] = "{{project.finish}}"; buf2 = io.BytesIO(); wb.save(buf2)
    t2 = c.post("/api/reports/templates", files={"file": ("v.xlsx", buf2.getvalue())}, data={"name": "버전 양식"}).json()
    assert t1["id"] == t2["id"] and t2["version"] == 2
    vs = c.get(f"/api/reports/templates/{t1['id']}/versions").json()
    assert len(vs) == 2 and vs[0]["current"] and vs[0]["fields"] == 2
    c.post(f"/api/reports/templates/{t1['id']}/restore", json={"file_id": vs[1]["file_id"]})
    assert c.get(f"/api/reports/templates/{t1['id']}/versions").json()[0]["fields"] == 1


def test_etag_and_gzip(db):
    c = TestClient(app)
    a, b = two(c)
    r = c.get(f"/api/uploads/{b}", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip" and r.headers.get("etag")
    r2 = c.get(f"/api/uploads/{b}", headers={"If-None-Match": r.headers["etag"]})
    assert r2.status_code == 304
