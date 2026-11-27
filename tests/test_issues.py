"""PMS P3: 이슈 탐지·상태 관리·자동 해결·게시 검토·AI 설명·브리핑·포트폴리오 질의."""
import re

from tests.fake_ai import FakeCLI
from tests.test_access import RAW, env, login  # noqa: F401

from app import ai, edition, issues


def _shrink(raw: bytes, code: str, hrs: int) -> bytes:
    """작업 code 의 원공기·잔여공기를 hrs 시간 줄인 XER (의심 변경 만들기)."""
    lines = raw.decode("utf-8").splitlines()
    out, cols, tbl = [], None, ""
    for ln in lines:
        f = ln.split("\t")
        if f[0] == "%T": tbl = f[1]
        if f[0] == "%F" and tbl == "TASK": cols = f
        if f[0] == "%R" and tbl == "TASK" and cols and f[cols.index("task_code")] == code:
            for k in ("target_drtn_hr_cnt", "remain_drtn_hr_cnt"):
                i = cols.index(k); f[i] = str(max(8, float(f[i]) - hrs))
        out.append("\t".join(f))
    return "\r\n".join(out).encode()


def test_issue_lifecycle(env, monkeypatch):
    monkeypatch.setattr(edition, "EDITION", "server")
    alice, adm, vic = login("alice"), login("admin"), login("vic")
    uid1 = alice.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    name = alice.get(f"/api/uploads/{uid1}").json()["name"]
    adm.put("/api/admin/thresholds", json={"spi_warn": 0.95})
    issues.evaluate(uid1)
    open1 = alice.get(f"/api/issues?project={name}").json()
    assert any(x["rule"] == "성과 지수" for x in open1)
    iid, ikey = open1[0]["id"], open1[0]["key"]
    # 상태 변경 권한: 소유자·관리자만, 조회자는 불가
    assert vic.post(f"/api/issues/{iid}", json={"status": "ack"}).status_code == 403
    x = alice.post(f"/api/issues/{iid}", json={"status": "doing", "assignee": "bob", "note": "협력사 회의"}).json()
    assert x["status"] == "doing" and x["assignee"] == "bob" and x["history"][-1]["note"] == "협력사 회의"
    assert any(n["kind"] == "assigned" for n in login("bob").get("/api/notifications").json()["items"])
    # 공기를 줄인 새 업데이트 → 게시 검토(의심 변경) 이슈, 지속 이슈는 누적
    code = next(a["code"] for a in alice.get(f"/api/uploads/{uid1}").json()["result"]["activities"] if a["status_code"] == "TK_NotStart" and a["orig_dur"] > 5)
    raw2 = _shrink(RAW, code, 16).replace(b"2026-03-02 08:00", b"2026-03-09 08:00")
    uid2 = alice.post("/api/upload", files={"file": ("p2.xer", raw2)}).json()["ids"][0]   # 대시보드 판은 업로드 때 자동 평가
    xs = {x["key"]: x for x in alice.get(f"/api/issues?project={name}").json()}
    assert "review" in xs and code in xs["review"]["detail"]
    if ikey in xs:   # 계속되는 이슈는 새로 만들지 않고 누적, 상태 유지
        assert xs[ikey]["id"] == iid and xs[ikey]["occurrences"] >= 2 and xs[ikey]["status"] == "doing"
    # 조건이 풀리면 자동 해결
    adm.put("/api/admin/thresholds", json={})
    adm.put(f"/api/uploads/{uid2}/thresholds", json={})
    monkeypatch.setattr(issues, "detect", lambda uid: [])
    issues.evaluate(uid2)
    assert alice.get(f"/api/issues?project={name}").json() == []
    assert all(x["status"] == "resolved" for x in alice.get(f"/api/issues?project={name}&status=resolved").json())


def test_issue_ai_and_briefing(env, monkeypatch):
    monkeypatch.setattr(edition, "EDITION", "server")
    alice, adm, vic = login("alice"), login("admin"), login("vic")
    uid = alice.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    name = alice.get(f"/api/uploads/{uid}").json()["name"]
    adm.put("/api/admin/thresholds", json={"spi_warn": 0.95})
    issues.evaluate(uid)
    b = vic.get("/api/dashboard/briefing").json()          # AI 꺼짐 → 규칙 브리핑
    assert b["method"] == "규칙" and name in b["text"]
    ai.PROVIDER = "cli"; fake = FakeCLI(); ai.set_runner(fake)
    try:
        iid = alice.get("/api/issues").json()[0]["id"]
        t = alice.post(f"/api/issues/{iid}/ai", json={}).json()
        assert t["cached"] is False and alice.post(f"/api/issues/{iid}/ai", json={}).json()["cached"] is True
        b2 = vic.get("/api/dashboard/briefing?refresh=1").json()
        assert b2["method"] == "AI"
        a = vic.post("/api/dashboard/ask", json={"q": "위험한 현장은?"}).json()
        assert a["projects"] == 2 and name in fake.calls[-1][1]   # env 의 이전 프로젝트 포함
        adm.put("/api/admin/ai-policy", json={"project": name, "policy": "forbid"})       # 금지 프로젝트는 AI 자료에서 빠짐
        a2 = vic.post("/api/dashboard/ask", json={"q": "위험한 현장은?"}).json()
        assert a2["projects"] == 1 and a2["excluded"] == 1 and name not in fake.calls[-1][1]
        assert alice.post(f"/api/issues/{iid}/ai", json={"refresh": True}).status_code == 400
    finally:
        ai.set_runner(None); ai.PROVIDER = "off"
