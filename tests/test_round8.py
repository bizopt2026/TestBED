"""8차: 날짜 고정, What-if 시작일, 포트폴리오 마일스톤, 회사 로고, 정적 파일 캐시."""
import base64
import io
import zipfile

from tests.test_access import RAW, env, login  # noqa: F401

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


def test_clock_and_whatif_and_portfolio(env, monkeypatch):
    from app import clock
    monkeypatch.setenv("APP_TODAY", "2026-04-01")
    assert clock.today().isoformat() == "2026-04-01"
    alice = login("alice")
    uid = alice.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    code = next(a for a in alice.get(f"/api/uploads/{uid}").json()["result"]["activities"] if a["status_code"] == "TK_NotStart")["code"]
    w = alice.post(f"/api/uploads/{uid}/whatif", json={"changes": [{"op": "set_duration", "code": code, "days": 60}]}).json()
    assert all("start_after" in c for c in w["changed"])
    p = alice.get("/api/portfolio").json()[0]
    assert p["milestones"] and {"code", "finish", "done"} <= set(p["milestones"][0]) and p["start"] <= p["finish"]


def test_logo_and_static_cache(env):
    adm, vic = login("admin"), login("vic")
    uid = login("alice").post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    assert vic.get("/api/logo").status_code == 404
    assert vic.post("/api/admin/logo", files={"file": ("l.png", PNG, "image/png")}).status_code == 403
    assert adm.post("/api/admin/logo", files={"file": ("x.gif", b"GIF89a....", "image/gif")}).status_code == 400
    assert adm.post("/api/admin/logo", files={"file": ("l.png", PNG, "image/png")}).status_code == 200
    assert vic.get("/api/logo").content == PNG
    assert 'alt="회사 로고"' in vic.get(f"/api/uploads/{uid}/a3.html").text
    z = zipfile.ZipFile(io.BytesIO(vic.get(f"/api/uploads/{uid}/package").content))
    docx = next(n for n in z.namelist() if n.endswith(".docx"))
    assert any(n.startswith("word/media/") for n in zipfile.ZipFile(io.BytesIO(z.read(docx))).namelist())   # 머리글 로고
    adm.delete("/api/admin/logo")
    assert vic.get("/api/logo").status_code == 404
    html = vic.get("/").text
    assert '/static/app.js?v=' in html and '/static/theme.css?v=' in html
    r = vic.get("/static/app.js?v=1")
    assert "immutable" in r.headers["cache-control"]
    assert vic.get("/static/app.js").headers["cache-control"] == "no-cache"
