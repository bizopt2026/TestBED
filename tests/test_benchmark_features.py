import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import ai, auth, services, storage  # noqa: E402
from app.main import app  # noqa: E402
from app.xer_parser import parse_xer  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
SAMPLE = os.path.join(ROOT, "samples", "sample_project.xer")
MSP = os.path.join(ROOT, "samples", "sample_msproject.xml")


@pytest.fixture
def client():
    storage.DB_PATH = os.path.join(tempfile.mkdtemp(), "b.db")
    storage.init()
    services._tables.cache_clear()
    ai.set_runner(None)
    ai.PROVIDER = 'off'
    yield TestClient(app)
    ai.PROVIDER = 'cli'


def up(c, raw=None, name="s.xer"):
    r = c.post("/api/upload", files={"file": (name, raw or open(SAMPLE, "rb").read())}, data={"uploader": "t"})
    assert r.status_code == 200, r.text
    return r.json()["ids"][0]


def two_updates(c):
    a = up(c)
    raw2 = open(SAMPLE, "rb").read().decode().replace("\t2026-03-02 08:00\tY", "\t2026-04-01 08:00\tY")
    return a, up(c, raw2.encode())


def test_health_score_and_settings(client):
    uid = up(client)
    h = client.get(f"/api/uploads/{uid}/health").json()
    assert 0 <= h["score"] <= 100 and len(h["metrics"]) >= 30
    before = h["score"]
    client.put(f"/api/uploads/{uid}/settings", json={"metric_overrides": {"R02": {"threshold": 50}, "F02": {"enabled": False}}})
    after = client.get(f"/api/uploads/{uid}/health").json()
    assert after["score"] >= before
    assert next(m for m in after["metrics"] if m["id"] == "F02")["pass"] is None


def test_forensic_and_trend(client):
    a, b = two_updates(client)
    f = client.get(f"/api/uploads/{b}/forensic").json()
    assert f["available"] and len(f["trend"]) == 2 and f["trend"][1]["finish_change"] == 30
    assert "items" in f["changes"] and "items" in f["compression"]


def test_risk_register_and_simulation(client):
    uid = up(client)
    r = client.post(f"/api/uploads/{uid}/risks", json={"title": "철골 자재 수급 지연", "codes": ["A2000", "ZZZ"],
                                                         "prob": 60, "impact_min": 5, "impact_ml": 10, "impact_max": 20})
    assert r.status_code == 200
    rs = client.get(f"/api/uploads/{uid}/risks").json()
    assert rs[0]["codes"] == ["A2000"] and rs[0]["exposure_days"] > 0
    sim = client.get(f"/api/uploads/{uid}/simulate?n=200").json()
    assert sim["risks_used"] == 1 and sim["risk_tornado"][0]["impact_days"] > 0
    base = client.get(f"/api/uploads/{uid}/simulate?n=200&risks=0").json()
    assert sim["p80"] >= base["p80"]
    assert client.post(f"/api/uploads/{uid}/risks", json={"title": ""}).status_code == 400


def test_recovery_options(client):
    uid = up(client)
    r = client.post(f"/api/uploads/{uid}/recovery", json={"days": 10}).json()
    assert len(r["options"]) == 3
    best = r["options"][0]
    assert best["gained_days"] > 0 and best["verified_gain"] == best["gained_days"]


def test_baseline_evm_resources(client):
    a, b = two_updates(client)
    bid = client.post(f"/api/uploads/{b}/baselines", json={"upload_id": a, "label": "최초 승인"}).json()["id"]
    v = client.get(f"/api/uploads/{b}/variance?baseline={bid}").json()
    assert v["project_var"] == 30
    e = client.get(f"/api/uploads/{b}/evm").json()
    assert e["available"] and e["bac"] > 0 and e["cpi"] < 1  # 샘플은 일부 작업 원가 초과
    assert len(e["history"]) == 2
    rh = client.get(f"/api/uploads/{b}/resources").json()
    assert rh["series"] and rh["weeks"]


def test_korea_holidays_and_calendar_patch(client):
    uid = up(client)
    k = client.get(f"/api/uploads/{uid}/korea").json()
    names = {h["name"] for h in k["holidays"]}
    assert {"광복절", "현충일", "대체공휴일"} <= names
    cal = next(c for c in k["calendars"] if not c["seven_day"])
    assert cal["missing"]  # 샘플 캘린더에는 추석 등이 빠져 있음
    dates = [m["date"] for m in cal["missing"]]
    x = client.post(f"/api/uploads/{uid}/xer_patch", json={"changes": [{"op": "add_holidays", "dates": dates, "clndr_ids": [cal["clndr_id"]]}]})
    from app.korea import calendar_check
    from datetime import date
    t = parse_xer(x.content)
    again = calendar_check(t, "100", date(2026, 3, 2), date(2026, 8, 26))
    assert not next(c for c in again if c["clndr_id"] == cal["clndr_id"])["missing"]
    client.put(f"/api/uploads/{uid}/settings", json={"weather_days": {"7": 8, "8": 6}})
    k2 = client.get(f"/api/uploads/{uid}/korea").json()
    assert any(m["weather"] > 0 for m in k2["review"]["months"])


def test_prediction_reports_insufficient_data(client):
    a, b = two_updates(client)
    p = client.get(f"/api/uploads/{b}/prediction").json()
    assert p["model"]["trained"] is False and p["items"] == []


def test_lookahead_commitments_ppc(client):
    uid = up(client)
    la = client.get(f"/api/uploads/{uid}/lookahead").json()
    assert la["rows"] and len(la["weeks"]) == 3
    w = la["weeks"][0]
    code = la["rows"][0]["code"]
    cid = client.post(f"/api/uploads/{uid}/records/commit", json={"week": w, "code": code, "company": "A건설", "done": False, "reason": "자재 미입고"}).json()["id"]
    client.post(f"/api/uploads/{uid}/records/commit", json={"week": w, "code": code, "company": "A건설", "done": True})
    client.post(f"/api/uploads/{uid}/records/constraint", json={"code": code, "type": "자재", "desc": "철근 입고", "due": w})
    p = client.get(f"/api/uploads/{uid}/ppc").json()
    assert p["weeks"][0]["ppc"] == 50 and p["reasons"][0][0] == "자재 미입고"
    assert client.get(f"/api/uploads/{uid}/lookahead").json()["rows"][0]["constraints"]
    assert client.post(f"/api/uploads/{uid}/records/commit", json={"week": "bad", "code": code}).status_code == 400
    assert client.delete(f"/api/uploads/{uid}/records/commit/{cid}").status_code == 200


def test_msp_import_template_generate_portfolio(client):
    uid = up(client, open(MSP, "rb").read(), "plan.xml")
    d = client.get(f"/api/uploads/{uid}").json()
    assert d["filename"].endswith("_변환.xer") and d["result"]["summary"]["activities"] == 5
    g = client.post("/api/generate", data={"project": "신규 물류센터", "start": "2026-05-04", "mode": "template", "template": "building"}).json()
    r = client.get(f"/api/uploads/{g['id']}").json()["result"]
    assert r["summary"]["activities"] == 20 and all(a["bl_finish"] for a in r["activities"])
    assert client.post("/api/generate", data={"project": "x", "start": "2026-05-04", "mode": "ai", "text": "x" * 60}).status_code == 503
    pf = client.get("/api/portfolio").json()
    assert {p["name"] for p in pf} >= {"신규 물류센터"}


def test_progress_override_setting_recalcs(client):
    uid = up(client)
    client.put(f"/api/uploads/{uid}/settings", json={"schedule_options": {"progress_override": True}})
    assert client.get(f"/api/uploads/{uid}").json()["result"]["options"] == {"progress_override": True}


def test_users_roles_csrf_audit(client):
    up(client)  # 공개 모드
    auth.create_user("admin1", "correct-horse-1", "admin")
    auth.create_user("view1", "correct-horse-2", "viewer")
    c = TestClient(app)
    assert c.get("/api/uploads").status_code == 401
    assert c.post("/api/login", json={"username": "view1", "password": "wrong-password"}).status_code == 401
    assert c.post("/api/login", json={"username": "view1", "password": "correct-horse-2"}).status_code == 200
    uid = c.get("/api/uploads").json()[0]["id"]
    H = {"X-Requested-With": "fetch"}
    assert c.post(f"/api/uploads/{uid}/whatif", json={"changes": []}, headers=H).status_code == 200  # viewer 계산 허용
    assert c.post(f"/api/uploads/{uid}/risks", json={"title": "x"}, headers=H).status_code == 403   # viewer 편집 불가
    a = TestClient(app)
    a.post("/api/login", json={"username": "admin1", "password": "correct-horse-1"})
    assert a.post(f"/api/uploads/{uid}/risks", json={"title": "x"}).status_code == 403  # CSRF 헤더 없음
    assert a.post(f"/api/uploads/{uid}/risks", json={"title": "x"}, headers=H).status_code == 200
    assert a.put("/api/admin/users/admin1", json={"active": False}, headers=H).status_code == 400
    audit = a.get("/api/admin/audit").json()
    assert any(x["path"].endswith("/risks") and x["username"] == "admin1" for x in audit)
    assert c.get("/api/admin/users").status_code == 403
    with storage.conn() as con:
        assert con.execute("SELECT pw_hash FROM users WHERE username='admin1'").fetchone()[0].startswith("scrypt$")


def test_msp_full_import_report_and_mpx(client):
    raw = open(os.path.join(ROOT, "samples", "sample_msproject_full.xml"), "rb").read()
    r = client.post("/api/upload", files={"file": ("full.xml", raw)}).json()
    rep = r["import_report"]
    assert rep["activities"] == 6 and rep["wbs"] == 2 and rep["assignments"] == 3 and rep["status_date"] == "2026-04-01"
    acts = {a["code"]: a for a in client.get(f"/api/uploads/{r['ids'][0]}").json()["result"]["activities"]}
    assert acts["1.1"]["wbs"] == "토목" and acts["2.2"]["constraint"] == "Start On or After"
    assert acts["2.2"]["preds"][0]["type"] == "SS" and acts["2.2"]["preds"][0]["lag"] == 5
    assert acts["1.2"]["bl_finish"] == "2026-03-26"
    e = client.get(f"/api/uploads/{r['ids'][0]}/evm").json()
    assert e["available"] and e["bac"] == 14000000
    from app import mpp_convert
    if mpp_convert.available():
        m = client.post("/api/upload", files={"file": ("p.mpx", open(os.path.join(ROOT, "samples", "sample_msproject.mpx"), "rb").read())})
        assert m.status_code == 200 and m.json()["import_report"]["source"] == "MPX"
    bad = client.post("/api/upload", files={"file": ("x.mpp", b"not a project file")})
    assert bad.status_code == 400
