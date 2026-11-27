"""클로즈드 테스트(현장 PM 업무)에서 나온 결함의 회귀 테스트."""
import os

from tests.test_security_beta import RAW, env, login  # noqa: F401  (fixture 재사용)
from app import storage


def _proj(c):
    return c.post("/api/upload", files={"file": ("p.xer", RAW)}).json()["ids"][0]


def test_final_zip_is_not_a_photo(env):  # noqa: F811
    alice = login("alice")
    uid = _proj(alice)
    for k in [s["key"] for s in alice.get(f"/api/uploads/{uid}/review").json()["steps"]]:
        alice.post(f"/api/uploads/{uid}/review/sign", json={"key": k})
    assert alice.post(f"/api/uploads/{uid}/final", json={}).status_code == 200
    assert alice.get(f"/api/uploads/{uid}/photos").json() == []          # 확정본 zip 은 사진 목록에 없음
    fid = storage.rec_get("final", uid)["file_id"]
    assert alice.delete(f"/api/photos/{fid}").status_code == 403           # 지울 수 없음
    assert alice.get(f"/api/uploads/{uid}/final/download").status_code == 200


def test_mentions_validation_compare_members(env):  # noqa: F811
    alice, bob = login("alice"), login("bob")
    uid = _proj(alice)
    name = storage.name_of(uid)
    r = alice.post(f"/api/uploads/{uid}/comments", json={"target": f"project:{name}", "text": "내일까지 @bob. 감사합니다"})
    assert "bob" in r.json().get("mentions", ["bob"]) or r.status_code == 200
    assert any("bob" in (x.get("mentions") or []) for x in storage.rec_list("comment", name))
    # 단건 입력도 없는 작업 코드는 거부, 리스크 영향은 0 이상·순서
    assert alice.post(f"/api/uploads/{uid}/records/constraint", json={"code": "ZZZZ", "type": "자재", "desc": "x"}).status_code == 400
    assert alice.post(f"/api/uploads/{uid}/risks", json={"title": "음수", "impact_min": -30}).status_code == 400
    assert alice.post(f"/api/uploads/{uid}/risks", json={"title": "뒤바뀜", "impact_min": 9, "impact_ml": 5, "impact_max": 7}).status_code == 400
    # What-if: 순환 관계·음수 공기 거부
    acts = alice.get(f"/api/uploads/{uid}").json()["result"]["activities"]
    first, last = acts[0]["code"], acts[-1]["code"]
    rels = alice.get(f"/api/uploads/{uid}").json()["result"]["activities"]
    by_id = {a["id"]: a["code"] for a in rels}
    succ_of_first = next((by_id.get(s["id"]) for a in rels if a["code"] == first for s in a.get("succs", [])), None)
    assert succ_of_first
    if succ_of_first:
        assert alice.post(f"/api/uploads/{uid}/whatif", json={"changes": [{"op": "add_rel", "pred": succ_of_first, "succ": first}]}).status_code == 400
    assert alice.post(f"/api/uploads/{uid}/whatif", json={"changes": [{"op": "set_duration", "code": last, "days": -5}]}).status_code == 400
    # 다른 프로젝트끼리 비교 불가, 조회 계정은 멤버 불가
    other = bob.post("/api/upload", files={"file": ("q.xml", open(os.path.join(os.path.dirname(__file__), "..", "samples", "sample_msproject_full.xml"), "rb").read())}).json()["ids"][0]
    assert alice.get(f"/api/compare?base={uid}&target={other}").status_code == 400
    assert alice.post(f"/api/projects/{name}/members", json={"username": "vic"}).status_code == 400


def test_docs_served(env):  # noqa: F811
    c = login("vic")   # 로그인한 사용자는 누구나
    for k, word in (("manual", "사용자 매뉴얼"), ("ops", "배포"), ("changelog", "변경 기록")):
        r = c.get(f"/api/docs/{k}")
        assert r.status_code == 200 and word in r.text
    assert c.get("/api/docs/../../etc/passwd").status_code == 404
    assert c.get("/api/docs/secret").status_code == 404
