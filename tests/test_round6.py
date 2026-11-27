"""6차 UI/UX: 타임라인, 상태 기준, 충돌 감지, '왜?' AI, 보고 패키지·확정본, 사용 현황."""
import io
import zipfile

from tests.fake_ai import FakeCLI
from tests.test_access import RAW, env, login  # noqa: F401

from app import ai


def _setup():
    alice, bob, vic, adm = login("alice"), login("bob"), login("vic"), login("admin")
    uid = alice.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    return alice, bob, vic, adm, uid, alice.get(f"/api/uploads/{uid}").json()["name"]


def test_timeline_thresholds(env):
    alice, bob, vic, adm, uid, name = _setup()
    vic.post(f"/api/uploads/{uid}/comments", json={"target": "project:x", "text": "확인 부탁"})
    tl = vic.get(f"/api/projects/{name}/timeline").json()
    assert tl[0]["id"] == uid and tl[0]["comments"][0]["text"] == "확인 부탁" and tl[0]["final"] is None
    assert alice.get(f"/api/uploads/{uid}/situation").json()["level"] == "ok"
    assert bob.put(f"/api/uploads/{uid}/thresholds", json={"spi_warn": 0.95}).status_code == 403
    assert alice.put(f"/api/uploads/{uid}/thresholds", json={"spi_warn": 0.95}).status_code == 403   # 소유자도 불가(관리자만)
    assert adm.put(f"/api/uploads/{uid}/thresholds", json={"spi_warn": "x"}).status_code == 400
    adm.put(f"/api/uploads/{uid}/thresholds", json={"spi_warn": 0.95, "health_warn": ""})
    assert alice.get(f"/api/uploads/{uid}/thresholds").json()["values"] == {"spi_warn": 0.95}
    assert alice.get(f"/api/uploads/{uid}/situation").json()["level"] == "warn"   # 샘플 SPI 0.8
    assert next(p for p in alice.get("/api/portfolio").json() if p["name"] == name)["level"] == "warn"


def test_conflict(env):
    alice, bob, vic, adm, uid, name = _setup()
    rid = alice.post(f"/api/uploads/{uid}/risks", json={"title": "우기", "prob": 30}).json()["id"]
    seen = next(x for x in alice.get(f"/api/uploads/{uid}/risks").json() if x["id"] == rid)
    import time
    time.sleep(1.1)
    adm.post(f"/api/uploads/{uid}/risks", json={**seen, "prob": 50, "base_updated_at": seen["updated_at"]})
    r = alice.post(f"/api/uploads/{uid}/risks", json={**seen, "prob": 60, "base_updated_at": seen["updated_at"]})
    assert r.status_code == 409 and r.json()["detail"]["updated_by"] == "admin"
    assert alice.post(f"/api/uploads/{uid}/risks", json={**seen, "prob": 60}).status_code == 200   # 덮어쓰기
    cid = alice.post(f"/api/uploads/{uid}/records/constraint", json={"code": "A2000", "type": "자재", "desc": "x"}).json()["id"]
    c = alice.get(f"/api/uploads/{uid}/lookahead").json()["constraints"][0]
    assert c["id"] == cid and c.get("updated_at")


def test_why_ai(env):
    alice, bob, vic, adm, uid, name = _setup()
    ai.PROVIDER = "off"
    assert alice.post(f"/api/uploads/{uid}/why/ai", json={"key": "spi"}).status_code == 400
    ai.PROVIDER = "cli"
    fake = FakeCLI()
    ai.set_runner(fake)
    try:
        d = alice.post(f"/api/uploads/{uid}/why/ai", json={"key": "spi"}).json()
        assert d["cached"] is False and "SPI" in fake.calls[0][1]
        assert alice.post(f"/api/uploads/{uid}/why/ai", json={"key": "spi"}).json()["cached"] is True
        assert bob.post(f"/api/uploads/{uid}/why/ai", json={"key": "spi"}).status_code == 200   # 읽기 전용 AI(편집 역할)
        assert vic.post(f"/api/uploads/{uid}/why/ai", json={"key": "spi"}).status_code == 403
    finally:
        ai.set_runner(None)
        ai.PROVIDER = "off"


def test_package_final_usage(env):
    alice, bob, vic, adm, uid, name = _setup()
    r = vic.get(f"/api/uploads/{uid}/package")
    assert r.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert any(n.endswith(".docx") for n in names) and any(n.endswith(".xlsx") for n in names)
    assert any(n.endswith("A3공정표.html") for n in names) and any(n.endswith(".csv") for n in names)
    assert "<svg" in vic.get(f"/api/uploads/{uid}/a3.html").text
    assert alice.post(f"/api/uploads/{uid}/final", json={}).status_code == 400   # 점검 전
    for k in [s["key"] for s in alice.get(f"/api/uploads/{uid}/review").json()["steps"]]:
        alice.post(f"/api/uploads/{uid}/review/sign", json={"key": k})
    assert vic.post(f"/api/uploads/{uid}/final", json={}).status_code == 403
    f = alice.post(f"/api/uploads/{uid}/final", json={}).json()
    assert f["review_by"] == "alice" and f["by"] == "alice"
    assert alice.post(f"/api/uploads/{uid}/final", json={}).status_code == 409
    z = vic.get(f"/api/uploads/{uid}/final/download")
    assert z.status_code == 200 and z.content[:2] == b"PK"
    assert vic.get(f"/api/projects/{name}/timeline").json()[0]["final"]["by"] == "alice"
    types = {h.get("type") for h in vic.get("/api/reports/history").json()}
    assert {"월간 보고 패키지", "확정본"} <= types
    # 사용 현황
    for s in ("overview", "overview", "gantt"):
        vic.post("/api/usage", json={"screen": s})
    assert vic.post("/api/usage", json={"screen": "../x"}).status_code == 400
    assert vic.get("/api/usage/mine").json() == {"overview": 2, "gantt": 1}
    assert vic.get("/api/admin/usage").status_code == 403
    u = adm.get("/api/admin/usage").json()
    assert u["screens"][0] == {"screen": "overview", "views": 2, "users": 1} and u["reviews_completed"] == 1
