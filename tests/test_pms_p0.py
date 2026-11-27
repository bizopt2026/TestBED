"""PMS P0: 판 구분(PMS 현장·PMS 대시보드), AI 실행 위치, 프로젝트별 AI 정책, 관리자 이슈 기준."""
from tests.fake_ai import FakeCLI
from tests.test_access import RAW, env, login  # noqa: F401

from app import ai, edition


def test_edition_and_ai_route(env, monkeypatch):
    c = login("vic").get("/api/config").json()
    assert c["edition"] == "client" and c["edition_name"] == "PMS 현장" and c["ai_mode"] == "server"
    assert c["ai_route"] == "local"                       # 대시보드에 연결하지 않은 단독 실행은 이 PC에서
    monkeypatch.setattr(edition, "HUB_URL", "http://pms-hub.local")
    assert edition.ai_route()[0] == "gateway"              # 연결되면 서버에서만 (결정 사항)
    monkeypatch.setattr(ai, "PROVIDER", "cli")
    assert "PMS 대시보드" in ai.blocked_reason()
    monkeypatch.setattr(edition, "EDITION", "server")
    assert edition.config()["edition_name"] == "PMS 대시보드" and edition.ai_route()[0] == "local"
    monkeypatch.setattr(edition, "AI_MODE", "off")
    assert edition.ai_route()[0] == "off"


def test_project_ai_policy(env):
    alice, adm = login("alice"), login("admin")
    uid = alice.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    name = alice.get(f"/api/uploads/{uid}").json()["name"]
    ai.PROVIDER = "cli"
    ai.set_runner(FakeCLI())
    try:
        assert alice.get(f"/api/ai/status?uid={uid}").json()["enabled"] is True
        assert alice.put("/api/admin/ai-policy", json={"project": name, "policy": "forbid"}).status_code == 403
        assert adm.put("/api/admin/ai-policy", json={"project": name, "policy": "forbid"}).status_code == 200
        st = alice.get(f"/api/ai/status?uid={uid}").json()
        assert st["enabled"] is False and "금지" in st["reason"]
        r = alice.post(f"/api/uploads/{uid}/why/ai", json={"key": "spi"})
        assert r.status_code == 400
        assert {"project": name, "policy": "forbid"} in adm.get("/api/admin/ai-policy").json()
        adm.put("/api/admin/ai-policy", json={"project": name, "policy": "allow"})
        assert alice.post(f"/api/uploads/{uid}/why/ai", json={"key": "spi"}).status_code == 200
    finally:
        ai.set_runner(None)
        ai.PROVIDER = "off"


def test_team_thresholds_admin_only(env):
    alice, adm = login("alice"), login("admin")
    uid = alice.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    assert alice.get(f"/api/uploads/{uid}/situation").json()["level"] == "ok"
    assert alice.put("/api/admin/thresholds", json={"spi_warn": 0.95}).status_code == 403
    assert adm.put("/api/admin/thresholds", json={"spi_warn": 0.95}).json()["values"] == {"spi_warn": 0.95}
    assert alice.get(f"/api/uploads/{uid}/situation").json()["level"] == "warn"     # 전사 기본값이 적용됨
    assert alice.get(f"/api/uploads/{uid}/thresholds").status_code == 200           # 조회는 가능


def test_backup_and_health(env):
    adm, vic = login("admin"), login("vic")
    assert vic.get("/api/admin/backup").status_code == 403
    r = adm.get("/api/admin/backup")
    assert r.status_code == 200 and r.content.startswith(b"SQLite format 3")
    h = vic.get("/api/health").json()
    assert h["ok"] and h["edition"] == "client" and h["projects"] >= 1
