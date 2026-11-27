import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(), "f.db"))

import pytest  # noqa: E402
from fake_ai import FakeCLI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import ai, services, storage  # noqa: E402
from app.main import app  # noqa: E402
from app.xer_parser import parse_xer  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
SAMPLE = os.path.join(ROOT, "samples", "sample_project.xer")


def upload(c, path=SAMPLE, raw=None):
    data = raw if raw is not None else open(path, "rb").read()
    r = c.post("/api/upload", files={"file": ("s.xer", data)}, data={"uploader": "t"})
    assert r.status_code == 200, r.text
    return r.json()["ids"][0]


@pytest.fixture
def client():
    storage.DB_PATH = os.path.join(tempfile.mkdtemp(), "t.db")
    storage.init()
    services._tables.cache_clear()
    ai.set_runner(None)
    ai.PROVIDER = 'off'
    yield TestClient(app)
    ai.set_runner(None)
    ai.PROVIDER = 'cli'


def test_whatif_and_xer_export(client):
    uid = upload(client)
    r = client.post(f"/api/uploads/{uid}/whatif", json={"changes": [{"op": "set_duration", "code": "A3030", "days": 25}]}).json()
    assert r["d_finish"] < 0  # 주공정 단축 -> 준공 앞당김
    r2 = client.post(f"/api/uploads/{uid}/whatif", json={"changes": [{"op": "set_duration", "code": "ZZZ", "days": 2}]})
    assert r2.status_code == 400
    x = client.post(f"/api/uploads/{uid}/xer_patch",
                    json={"changes": [{"op": "add_rel", "pred": "A3070", "succ": "A4020", "type": "FS", "lag": 0}]})
    assert x.status_code == 200
    t = parse_xer(x.content)
    assert len(t["TASKPRED"]) == len(parse_xer(open(SAMPLE, "rb").read())["TASKPRED"]) + 1
    s = client.post(f"/api/uploads/{uid}/scenarios", json={"name": "단축안", "changes": [{"op": "set_duration", "code": "A2010", "days": 20}]}).json()
    assert client.get(f"/api/uploads/{uid}/scenarios").json()[0]["id"] == s["id"]


def test_delay_risk_mc_bench_daily_report_without_ai(client):
    a = upload(client)
    raw = open(SAMPLE, "rb").read().decode()
    raw2 = raw.replace("\t2026-03-02 08:00\tY", "\t2026-04-01 08:00\tY")
    b = upload(client, raw=raw2.encode())
    d = client.get(f"/api/uploads/{b}/delay").json()
    assert d["available"] and d["finish_slip"] == 30 and d["top"]
    assert client.get(f"/api/uploads/{a}/delay").json()["available"] is False
    rk = client.get(f"/api/uploads/{b}/risk").json()
    assert rk["items"][0]["score"] >= rk["items"][-1]["score"]
    mc = client.get(f"/api/uploads/{b}/montecarlo?n=100").json()
    assert mc["p50"] <= mc["p90"] and mc["iterations"] > 0
    assert "trades" in client.get(f"/api/uploads/{b}/benchmark").json()
    dl = client.post(f"/api/uploads/{b}/daily", json={"text": "A1050 기초 철근 착수 20%", "date": "2026-04-02"}).json()
    assert dl["method"] == "규칙" and dl["changes"][0]["code"] == "A1050"
    rep = client.post(f"/api/uploads/{b}/report").json()
    assert rep["method"] == "템플릿" and "준공" in rep["sections"]["headline"]
    doc = client.get(f"/api/uploads/{b}/report.docx")
    assert doc.status_code == 200 and doc.content[:2] == b"PK"
    g = client.get(f"/api/uploads/{b}/dcma_guide").json()
    assert g["guides"]
    assert client.post(f"/api/uploads/{b}/chat", json={"messages": [{"role": "user", "content": "hi"}]}).status_code == 503


def test_ai_features_with_fake_cli(client):
    uid = upload(client)
    fake = FakeCLI()
    ai.set_runner(fake)
    ch = client.post(f"/api/uploads/{uid}/chat", json={"messages": [{"role": "user", "content": "주공정 알려줘"}], "context": "risk"}).json()
    assert ch["codes"] == ["A2010"] and ch["turns"] == 3
    args, prompt = fake.calls[-1]
    assert args[args.index("--tools") + 1] == "" and "--strict-mcp-config" in args       # 기본 도구 차단
    assert args[args.index("--allowedTools") + 1] == "mcp__sched"
    cfg = json.loads(args[args.index("--mcp-config") + 1])
    assert cfg["mcpServers"]["sched"]["args"][-1] == uid
    assert "리스크" in args[args.index("--system-prompt") + 1]
    tr = client.post(f"/api/uploads/{uid}/trades").json()
    assert tr["method"] == "AI" and tr["map"]["A2010"] == "철골"
    rs = client.get(f"/api/uploads/{uid}/rel_suggest?ai=1").json()
    assert rs["method"] == "AI" and rs["items"][0]["pred"] == "A3070"
    dl = client.post(f"/api/uploads/{uid}/daily", json={"text": "기초 철근 작업 시작"}).json()
    assert dl["method"] == "AI" and dl["changes"][0]["act_start"] == "2026-03-05"
    rep = client.post(f"/api/uploads/{uid}/report").json()
    assert rep["method"] == "AI" and rep["sections"]["headline"]
    assert client.get(f"/api/uploads/{uid}/dcma_guide?ai=1").json()["narrative"]
    ex = client.post(f"/api/uploads/{uid}/risks/extract", json={"text": "철골 납품이 늦어질 수 있음"}).json()
    assert ex[0]["codes"] == ["A2000"]
    g = client.post("/api/generate", data={"project": "AI 생성", "start": "2026-05-04", "mode": "ai", "text": "도로 공사 " * 20}).json()
    assert g["assumptions"] == ["테스트 가정"]
    usage = client.get("/api/ai/status").json()["usage"]
    assert {u["feature"] for u in usage} >= {"chat", "classify", "report"}


def test_cli_failure_maps_to_errors(client):
    uid = upload(client)
    ai.set_runner(lambda a, p: {"type": "result", "subtype": "error_max_turns", "is_error": True, "result": "too many"})
    assert client.post(f"/api/uploads/{uid}/chat", json={"messages": [{"role": "user", "content": "x"}]}).status_code == 502
    ai.set_runner(lambda a, p: {"type": "result", "subtype": "success", "stop_reason": "refusal", "result": ""})
    assert client.post(f"/api/uploads/{uid}/chat", json={"messages": [{"role": "user", "content": "x"}]}).status_code == 422


def test_mcp_server_protocol(client):
    import subprocess
    uid = upload(client)
    msgs = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_activity", "arguments": {"code": "A2010"}}},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "get_activity", "arguments": {"code": "NOPE"}}}]
    env = {**os.environ, "DB_PATH": storage.DB_PATH, "PYTHONPATH": ROOT}
    p = subprocess.run([sys.executable, "-m", "app.mcp_server", uid], input="\n".join(json.dumps(m) for m in msgs),
                       capture_output=True, text=True, env=env, cwd=ROOT, timeout=60)
    out = [json.loads(x) for x in p.stdout.splitlines()]
    assert [o["id"] for o in out] == [1, 2, 3, 4]
    assert any(t["name"] == "what_if" for t in out[1]["result"]["tools"])
    assert json.loads(out[2]["result"]["content"][0]["text"])["code"] == "A2010"
    assert out[3]["result"]["isError"] is True
