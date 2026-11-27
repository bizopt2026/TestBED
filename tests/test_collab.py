"""5차 UI/UX: 점검 기록, 코멘트·멘션, 담당자, 일괄 입력, 사용자 설정, 상황판 해석, 분할 로딩."""
from tests.test_access import RAW, env, login  # noqa: F401

from app import access


def _setup():
    alice, bob, vic = login("alice"), login("bob"), login("vic")
    uid = alice.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]
    name = alice.get(f"/api/uploads/{uid}").json()["name"]
    return alice, bob, vic, uid, name


def test_review_signoff(env):
    alice, bob, vic, uid, name = _setup()
    access.set_member(name, "bob", "member", "alice")
    keys = [s["key"] for s in alice.get(f"/api/uploads/{uid}/review").json()["steps"]]
    assert vic.post(f"/api/uploads/{uid}/review/sign", json={"key": keys[0]}).status_code == 403
    assert alice.post(f"/api/uploads/{uid}/review/sign", json={"key": "nope"}).status_code == 400
    for k in keys:
        d = alice.post(f"/api/uploads/{uid}/review/sign", json={"key": k, "note": "확인"}).json()
    assert d["completed_by"] == "alice" and d["steps"][keys[0]]["note"] == "확인"
    assert alice.get(f"/api/uploads/{uid}/situation").json()["review"]["completed_by"] == "alice"
    p = next(x for x in alice.get("/api/portfolio").json() if x["name"] == name)
    assert p["review"]["completed_by"] == "alice" and p["history"]
    assert any(n["kind"] == "review" for n in bob.get("/api/notifications").json()["items"])


def test_comments_mentions_and_tasks(env):
    alice, bob, vic, uid, name = _setup()
    # 읽기 사용자도 코멘트 가능, @멘션은 알림
    r = vic.post(f"/api/uploads/{uid}/comments", json={"target": "activity:A2000", "text": "@alice 자재 반입 확인 부탁 @nobody"})
    assert r.status_code == 200 and r.json()["mentions"] == ["alice"]
    cid = r.json()["id"]
    assert alice.get("/api/notifications").json()["items"][0]["kind"] == "mention"
    assert [c["text"] for c in bob.get(f"/api/uploads/{uid}/comments?target=activity:A2000").json()]
    assert any(t["kind"] == "멘션" for t in alice.get("/api/my/tasks").json())
    assert bob.post(f"/api/uploads/{uid}/comments/{cid}/resolve", json={}).status_code == 403
    assert alice.post(f"/api/uploads/{uid}/comments/{cid}/resolve", json={}).status_code == 200
    assert not any(t["kind"] == "멘션" for t in alice.get("/api/my/tasks").json())
    assert bob.delete(f"/api/uploads/{uid}/comments/{cid}").status_code == 403
    assert vic.delete(f"/api/uploads/{uid}/comments/{cid}").status_code == 200
    # 담당자 지정 → 알림 + 내게 배정된 일
    alice.post(f"/api/uploads/{uid}/risks", json={"title": "철골 지연", "codes": ["A2000"], "prob": 30, "assignee": "bob", "due": "2026-12-01"})
    alice.post(f"/api/uploads/{uid}/records/constraint", json={"code": "A2000", "type": "자재", "desc": "철골", "assignee": "bob"})
    kinds = [t["kind"] for t in bob.get("/api/my/tasks").json()]
    assert "리스크" in kinds and "제약" in kinds
    assert sum(n["kind"] == "assigned" for n in bob.get("/api/notifications").json()["items"]) == 2


def test_bulk_and_prefs(env):
    alice, bob, vic, uid, name = _setup()
    rows = [{"code": "A2000", "type": "자재", "desc": "철골 반입", "due": "2026-12-01"},
            {"code": "ZZZ", "type": "인력", "desc": "x"}, {"code": "A2000", "type": "도면", "due": "12/01"}]
    d = alice.post(f"/api/uploads/{uid}/bulk/constraint", json={"rows": rows, "dry_run": True}).json()
    assert d["valid"] == 1 and [e["row"] for e in d["errors"]] == [2, 3]
    assert alice.post(f"/api/uploads/{uid}/bulk/constraint", json={"rows": rows}).json()["saved"] == 1
    assert bob.post(f"/api/uploads/{uid}/bulk/risk", json={"rows": [{"title": "x"}]}).status_code == 403
    assert alice.post(f"/api/uploads/{uid}/bulk/risk", json={"rows": [{"title": "우기", "prob": 40, "impact_ml": 5}]}).json()["saved"] == 1
    # 알림 설정: 끈 종류는 오지 않음
    p = bob.get("/api/me/prefs").json()
    assert "mention" in p["notify"] and p["start_page"] == "home"
    assert vic.put("/api/me/prefs", json={"start_page": "portfolio", "term_mode": "ko"}).json()["term_mode"] == "ko"
    bob.put("/api/me/prefs", json={"notify": ["access"]})
    alice.post(f"/api/uploads/{uid}/comments", json={"target": "project:x", "text": "@bob 확인"})
    assert not any(n["kind"] == "mention" for n in bob.get("/api/notifications").json()["items"])


def test_lite_and_explain(env):
    alice, bob, vic, uid, name = _setup()
    lite = alice.get(f"/api/uploads/{uid}?lite=1").json()
    assert lite["lite"] and "activities" not in lite["result"] and lite["result"]["activity_count"] > 0
    full = alice.get(f"/api/uploads/{uid}/activities").json()
    assert len(full["activities"]) == lite["result"]["activity_count"]
    s = alice.get(f"/api/uploads/{uid}/situation").json()
    assert isinstance(s["why"], dict) and all("series_label" in k for k in s["kpis"])
