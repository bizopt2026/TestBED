"""웹 서버 (FastAPI)."""
from __future__ import annotations

import csv
import io
import os
import re
from datetime import date

from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from urllib.parse import unquote

from . import ai, auth as auth_mod, services, storage
from .analysis import analyze
from .changes import ChangeError
from .schedule import Schedule, list_projects
from .xer_parser import parse_xer

STATIC = os.path.join(os.path.dirname(__file__), "..", "static")
MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "100")) * 1024 * 1024
APP_TOKEN = os.environ.get("APP_TOKEN", "")

app = FastAPI(title="공정관리 XER 분석기")
storage.init()
auth_mod.bootstrap_from_env()
SECURE_COOKIE = os.environ.get("SECURE_COOKIE", "0") == "1"

PUBLIC = {"/api/config", "/api/login", "/api/logout", "/api/me"}
# 조회 권한(viewer)으로도 허용되는 계산 전용 POST
VIEWER_POST = ("/whatif", "/recovery")
ADMIN_ONLY = ("/api/admin/",)


def _required_role(method: str, path: str) -> str:
    if any(path.startswith(p) for p in ADMIN_ONLY):
        return "admin"
    if method == "DELETE" and path.startswith("/api/uploads/") and path.count("/") == 3:
        return "admin"
    if path.startswith("/api/settings/team"):
        return "admin" if method != "GET" else "viewer"
    if method == "GET" or (method == "POST" and path.endswith(VIEWER_POST)):
        return "viewer"
    return "editor"


@app.middleware("http")
async def security(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/") or path in PUBLIC:
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        return resp
    if auth_mod.users_exist():
        user = auth_mod.session_user(request.cookies.get(auth_mod.COOKIE))
        if not user:
            return JSONResponse({"detail": "로그인이 필요합니다"}, status_code=401)
        if request.method in ("POST", "PUT", "DELETE") and request.headers.get("x-requested-with") != "fetch":
            return JSONResponse({"detail": "잘못된 요청입니다"}, status_code=403)  # CSRF 방지
    else:
        if APP_TOKEN and request.headers.get("x-app-token") != APP_TOKEN:
            return JSONResponse({"detail": "접근 토큰이 올바르지 않습니다"}, status_code=401)
        user = {"username": unquote(request.headers.get("x-user", ""))[:50] or "익명", "role": "admin"}
    need = _required_role(request.method, path)
    if auth_mod.ROLES[user["role"]] < auth_mod.ROLES[need]:
        return JSONResponse({"detail": f"권한이 없습니다 ({need} 이상 필요)"}, status_code=403)
    request.state.user = user
    resp = await call_next(request)
    if request.method in ("POST", "PUT", "DELETE") and not path.endswith(VIEWER_POST):
        storage.audit(user["username"], request.method, path, resp.status_code)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Cache-Control", "no-store")
    return resp


def auth():  # 인증·권한은 미들웨어에서 처리 (하위 호환용)
    return None


@app.get("/api/config")
def config():
    return {"token_required": bool(APP_TOKEN) and not auth_mod.users_exist(), "login_required": auth_mod.users_exist(),
            "ai": ai.status()["enabled"]}


@app.post("/api/login")
def login(body: dict = Body(...)):
    try:
        token = auth_mod.login(str(body.get("username", "")), str(body.get("password", "")))
    except PermissionError as e:
        raise HTTPException(401, str(e))
    storage.audit(body.get("username", ""), "POST", "/api/login", 200)
    resp = JSONResponse({"ok": True})
    resp.set_cookie(auth_mod.COOKIE, token, httponly=True, samesite="strict", secure=SECURE_COOKIE,
                    max_age=int(auth_mod.SESSION_HOURS * 3600), path="/")
    return resp


@app.post("/api/logout")
def logout(request: Request):
    tok = request.cookies.get(auth_mod.COOKIE)
    if tok:
        auth_mod.logout(tok)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth_mod.COOKIE, path="/")
    return resp


@app.get("/api/me")
def me(request: Request):
    if not auth_mod.users_exist():
        return {"username": None, "role": "admin", "mode": "open"}
    u = auth_mod.session_user(request.cookies.get(auth_mod.COOKIE))
    if not u:
        raise HTTPException(401, "로그인이 필요합니다")
    return {**u, "mode": "users"}


@app.post("/api/upload", dependencies=[Depends(auth)])
async def upload(request: Request, file: UploadFile = File(...), uploader: str = Form(""), note: str = Form("")):
    raw = await file.read()
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "파일이 너무 큽니다")
    if auth_mod.users_exist():
        uploader = request.state.user["username"]
    fname = file.filename or "upload.xer"
    try:
        if fname.lower().endswith(".xml"):
            from .importers import msp_xml_to_tables, tables_to_xer
            raw = tables_to_xer(msp_xml_to_tables(raw))
            fname = re.sub(r"\.xml$", "", fname, flags=re.I) + "_MSP변환.xer"
        tables = parse_xer(raw)
        projects = list_projects(tables)
        if not projects:
            raise ValueError("PROJECT 테이블이 없습니다")
        ids = []
        for p in projects:
            try:
                s = Schedule(tables, p["proj_id"], services.sched_options(p["name"]))
            except ValueError:
                continue
            result = analyze(s)
            ids.append(storage.save(fname, p["proj_id"], result["name"],
                                    uploader.strip() or "익명", note.strip(), raw, result))
        if not ids:
            raise ValueError("분석 가능한 프로젝트(액티비티 포함)가 없습니다")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ids": ids}


@app.get("/api/uploads", dependencies=[Depends(auth)])
def uploads():
    return storage.listing()


@app.get("/api/uploads/{uid}", dependencies=[Depends(auth)])
def get_upload(uid: str):
    d = storage.get(uid)
    if not d:
        raise HTTPException(404, "없는 데이터입니다")
    d.pop("raw", None)
    return d


@app.delete("/api/uploads/{uid}", dependencies=[Depends(auth)])
def delete_upload(uid: str):
    if not storage.delete(uid):
        raise HTTPException(404, "없는 데이터입니다")
    return {"ok": True}


@app.get("/api/uploads/{uid}/xer", dependencies=[Depends(auth)])
def download_xer(uid: str):
    r = storage.get_raw(uid)
    if not r:
        raise HTTPException(404)
    return Response(r["raw"], media_type="application/octet-stream",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_q(r['filename'])}"})


@app.post("/api/uploads/{uid}/recalc", dependencies=[Depends(auth)])
def recalc(uid: str):
    """엔진 개선 후 기존 업로드를 다시 계산."""
    r = storage.get_raw(uid)
    if not r:
        raise HTTPException(404)
    name = storage.get(uid)["name"]
    result = analyze(Schedule(parse_xer(r["raw"]), r["proj_id"], services.sched_options(name)))
    storage.update_result(uid, result)
    for k in ("dcma_narrative", "report"):
        storage.del_extra(uid, k)
    services._tables.cache_clear()
    return {"ok": True}


def _q(s: str) -> str:
    from urllib.parse import quote
    return quote(s or "export")


@app.get("/api/uploads/{uid}/activities.csv", dependencies=[Depends(auth)])
def export_csv(uid: str):
    d = storage.get(uid)
    if not d:
        raise HTTPException(404)
    cols = [("code", "Activity ID"), ("name", "Activity Name"), ("wbs", "WBS"), ("status", "상태"),
            ("orig_dur", "원공기(일)"), ("rem_dur", "잔여공기(일)"), ("pct", "공정률(%)"),
            ("start", "시작"), ("finish", "종료"), ("late_start", "Late Start"), ("late_finish", "Late Finish"),
            ("tf", "Total Float"), ("ff", "Free Float"), ("critical", "주공정"),
            ("bl_start", "계획시작"), ("bl_finish", "계획종료"), ("constraint", "제약조건")]
    buf = io.StringIO()
    buf.write("﻿")
    w = csv.writer(buf)
    w.writerow([c[1] for c in cols])
    for a in d["result"]["activities"]:
        w.writerow([("Y" if a[k] else "") if k == "critical" else (a[k] if a[k] is not None else "")
                    for k, _ in cols])
    name = f"{d['name']}_{d['data_date']}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_q(name)}"})


@app.get("/api/compare", dependencies=[Depends(auth)])
def compare(base: str, target: str):
    """두 업데이트(예: 지난달 vs 이번달) 비교."""
    a, b = storage.get(base), storage.get(target)
    if not a or not b:
        raise HTTPException(404)
    ra, rb = a["result"], b["result"]
    ma = {x["code"]: x for x in ra["activities"]}
    mb = {x["code"]: x for x in rb["activities"]}
    added = [mb[k] for k in mb.keys() - ma.keys()]
    removed = [ma[k] for k in ma.keys() - mb.keys()]
    changed = []
    for k in ma.keys() & mb.keys():
        x, y = ma[k], mb[k]
        df = (date.fromisoformat(y["finish"]) - date.fromisoformat(x["finish"])).days
        dtf = (y["tf"] - x["tf"]) if x["tf"] is not None and y["tf"] is not None else None
        dur = y["orig_dur"] - x["orig_dur"]
        if df or (dtf or 0) or dur or x["name"] != y["name"]:
            changed.append({"code": k, "name": y["name"], "status_before": x["status"],
                            "status_after": y["status"], "finish_before": x["finish"],
                            "finish_after": y["finish"], "d_finish": df, "tf_before": x["tf"],
                            "tf_after": y["tf"], "d_tf": dtf, "d_dur": dur,
                            "critical": y["critical"]})
    changed.sort(key=lambda c: -abs(c["d_finish"]))
    pick = lambda xs: [{"code": x["code"], "name": x["name"], "start": x["start"], "finish": x["finish"]}
                       for x in xs]
    return {
        "base": {"id": base, "name": ra["name"], "data_date": ra["data_date"], "finish": ra["finish"]},
        "target": {"id": target, "name": rb["name"], "data_date": rb["data_date"], "finish": rb["finish"]},
        "finish_slip": (date.fromisoformat(rb["finish"]) - date.fromisoformat(ra["finish"])).days,
        "added": pick(added), "removed": pick(removed), "changed": changed[:1000],
    }


# ============================================================ AI·분석 기능

@app.exception_handler(ai.AIUnavailable)
async def _ai_off(_: Request, e: Exception):
    return JSONResponse({"detail": str(e)}, status_code=503)


@app.exception_handler(ai.AIRefused)
async def _ai_refused(_: Request, e: Exception):
    return JSONResponse({"detail": str(e)}, status_code=422)


@app.exception_handler(ChangeError)
async def _change_err(_: Request, e: Exception):
    return JSONResponse({"detail": str(e)}, status_code=400)


@app.exception_handler(KeyError)
async def _not_found(_: Request, e: Exception):
    return JSONResponse({"detail": "없는 데이터입니다"}, status_code=404)


@app.exception_handler(ai.AIFailed)
async def _ai_failed(_: Request, e: Exception):
    return JSONResponse({"detail": str(e)}, status_code=502)


def _user(request: Request) -> str:
    u = getattr(request.state, "user", None)
    return (u or {}).get("username", "")


@app.get("/api/ai/status", dependencies=[Depends(auth)])
def ai_status():
    return {**ai.status(), "usage": storage.ai_usage()}


@app.post("/api/uploads/{uid}/chat", dependencies=[Depends(auth)])
def chat(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    try:
        return services.chat(uid, body.get("messages") or [], user, str(body.get("context") or ""))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/uploads/{uid}/dcma_guide", dependencies=[Depends(auth)])
def dcma_guide(uid: str, ai_: int = Query(0, alias="ai"), user: str = Depends(_user)):
    return services.dcma_guide(uid, bool(ai_), user)


@app.get("/api/uploads/{uid}/delay", dependencies=[Depends(auth)])
def delay(uid: str, base: str | None = None):
    return services.delay(uid, base)


@app.post("/api/uploads/{uid}/whatif", dependencies=[Depends(auth)])
def whatif(uid: str, body: dict = Body(...)):
    return services.whatif(uid, body.get("changes") or [])


@app.post("/api/uploads/{uid}/xer_patch", dependencies=[Depends(auth)])
def xer_patch(uid: str, body: dict = Body(...)):
    data, name = services.export_xer(uid, body.get("changes") or [])
    return Response(data, media_type="application/octet-stream",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_q(name)}"})


@app.get("/api/uploads/{uid}/scenarios", dependencies=[Depends(auth)])
def scenarios(uid: str):
    return storage.scenarios(uid)


@app.post("/api/uploads/{uid}/scenarios", dependencies=[Depends(auth)])
def save_scenario(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    changes = body.get("changes") or []
    summary = services.whatif(uid, changes)
    summary = {k: summary[k] for k in ("log", "finish_before", "finish_after", "d_finish")}
    sid = storage.save_scenario(uid, body.get("name") or "시나리오", body.get("kind") or "whatif",
                                changes, summary, user or "익명")
    return {"id": sid, "summary": summary}


@app.delete("/api/scenarios/{sid}", dependencies=[Depends(auth)])
def delete_scenario(sid: str):
    if not storage.delete_scenario(sid):
        raise HTTPException(404)
    return {"ok": True}


@app.get("/api/uploads/{uid}/rel_suggest", dependencies=[Depends(auth)])
def rel_suggest(uid: str, ai_: int = Query(0, alias="ai"), user: str = Depends(_user)):
    return services.rel_suggest(uid, bool(ai_), user)


@app.get("/api/uploads/{uid}/trades", dependencies=[Depends(auth)])
def trades(uid: str):
    return services.trade_summary(uid)


@app.post("/api/uploads/{uid}/trades", dependencies=[Depends(auth)])
def classify(uid: str, ai_: int = Query(1, alias="ai"), user: str = Depends(_user)):
    return services.classify(uid, bool(ai_), user)


@app.get("/api/uploads/{uid}/montecarlo", dependencies=[Depends(auth)])
def montecarlo(uid: str, n: int = 300):
    return services.monte_carlo(uid, n)


@app.get("/api/uploads/{uid}/risk", dependencies=[Depends(auth)])
def risk(uid: str, limit: int = 50):
    return services.risk(uid, limit)


@app.get("/api/uploads/{uid}/benchmark", dependencies=[Depends(auth)])
def benchmark(uid: str):
    return services.bench(uid)


@app.post("/api/uploads/{uid}/daily", dependencies=[Depends(auth)])
def daily(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "작업일보 내용을 입력하세요")
    return services.daily_extract(uid, text[:20000], body.get("date"), user)


@app.post("/api/uploads/{uid}/report", dependencies=[Depends(auth)])
def make_report(uid: str, base: str | None = None, ai_: int = Query(1, alias="ai"), user: str = Depends(_user)):
    rep = services.report(uid, base, bool(ai_), user)
    storage.set_extra(uid, "report", rep)
    return rep


@app.get("/api/uploads/{uid}/report", dependencies=[Depends(auth)])
def get_report(uid: str):
    return storage.get_extra(uid, "report") or {}


@app.put("/api/uploads/{uid}/report", dependencies=[Depends(auth)])
def edit_report(uid: str, body: dict = Body(...)):
    rep = storage.get_extra(uid, "report")
    if not rep:
        raise HTTPException(404, "먼저 보고서를 생성하세요")
    rep["sections"].update({k: str(v) for k, v in (body.get("sections") or {}).items() if k in rep["sections"]})
    storage.set_extra(uid, "report", rep)
    return rep


@app.get("/api/uploads/{uid}/report.docx", dependencies=[Depends(auth)])
def report_docx(uid: str):
    rep = storage.get_extra(uid, "report") or services.report(uid, None, False)
    data = services.report_docx(rep)
    name = f"{rep['data']['project']}_월간공정보고_{rep['data']['data_date']}.docx"
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_q(name)}"})


# ============================================================ 2차: 벤치마크 반영 기능

def _name(uid: str) -> str:
    return services.project_name(uid)


@app.get("/api/portfolio")
def portfolio():
    return services.portfolio()


@app.get("/api/uploads/{uid}/health")
def health(uid: str):
    return services.health(uid)


@app.get("/api/metrics/defaults")
def metric_defaults():
    from .metrics import defaults
    return defaults()


@app.get("/api/uploads/{uid}/settings")
def get_settings(uid: str):
    n = _name(uid)
    return {"project": n, "metric_overrides": storage.setting(n, "metric_overrides", {}) or {},
            "team_metric_overrides": storage.setting("*", "metric_overrides", {}) or {},
            "schedule_options": services.sched_options(n),
            "weather_days": storage.setting(n, "weather_days", {}) or {},
            "extra_holidays": storage.setting("*", "extra_holidays", []) or []}


@app.put("/api/uploads/{uid}/settings")
def put_settings(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    n = _name(uid)
    if "metric_overrides" in body:
        storage.set_setting(n, "metric_overrides", _clean_overrides(body["metric_overrides"]), user)
    if "schedule_options" in body:
        opts = {"progress_override": bool((body["schedule_options"] or {}).get("progress_override"))}
        storage.set_setting(n, "schedule_options", opts, user)
        for h in storage.history(n):  # 일정 옵션이 바뀌면 같은 프로젝트 전체 재계산
            recalc(h["id"])
    if "weather_days" in body:
        wd = {str(int(k)): max(0.0, min(31.0, float(v or 0))) for k, v in (body["weather_days"] or {}).items() if 1 <= int(k) <= 12}
        storage.set_setting(n, "weather_days", wd, user)
    return get_settings(uid)


@app.put("/api/settings/team")
def put_team_settings(body: dict = Body(...), user: str = Depends(_user)):
    if "metric_overrides" in body:
        storage.set_setting("*", "metric_overrides", _clean_overrides(body["metric_overrides"]), user)
    if "extra_holidays" in body:
        hs = []
        for h in body["extra_holidays"] or []:
            try:
                hs.append({"date": date.fromisoformat(h["date"]).isoformat(), "name": str(h.get("name", ""))[:40]})
            except (KeyError, ValueError, TypeError):
                continue
        storage.set_setting("*", "extra_holidays", hs, user)
    return {"ok": True}


def _clean_overrides(d: dict) -> dict:
    from .metrics import METRICS
    ids = {m[0] for m in METRICS}
    out = {}
    for k, v in (d or {}).items():
        if k in ids and isinstance(v, dict):
            o = {}
            if v.get("threshold") not in (None, ""):
                o["threshold"] = float(v["threshold"])
            if v.get("weight") not in (None, ""):
                o["weight"] = max(0.0, float(v["weight"]))
            if "enabled" in v:
                o["enabled"] = bool(v["enabled"])
            out[k] = o
    return out


@app.get("/api/uploads/{uid}/forensic")
def forensic(uid: str, base: str | None = None):
    return services.forensic(uid, base)


# ---- 리스크 레지스터
@app.get("/api/uploads/{uid}/risks")
def list_risks(uid: str):
    return services.risks(uid)


@app.post("/api/uploads/{uid}/risks")
def add_risk(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    valid = {a["code"] for a in services.result(uid)["activities"]}
    try:
        x = services.clean_risk(body, valid)
    except ValueError as e:
        raise HTTPException(400, str(e))
    rid = storage.rec_put("risk", _name(uid), x, user, rid=body.get("id") or None)
    return {"id": rid}


@app.delete("/api/uploads/{uid}/risks/{rid}")
def del_risk(uid: str, rid: str):
    r = storage.rec_get("risk", rid)
    if not r or r["scope"] != _name(uid):
        raise HTTPException(404)
    storage.rec_del("risk", rid)
    return {"ok": True}


@app.post("/api/uploads/{uid}/risks/extract")
def extract_risks(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "문서 내용을 입력하세요")
    return services.risk_extract(uid, text[:60000], user)


@app.get("/api/uploads/{uid}/simulate")
def simulate(uid: str, n: int = 500, risks: int = 1, uncertainty: int = 1):
    return services.simulate(uid, n, bool(risks), bool(uncertainty))


# ---- 자동 만회안 (계산 전용)
@app.post("/api/uploads/{uid}/recovery")
def recovery(uid: str, body: dict = Body(...)):
    days = int(body.get("days") or 0)
    if not 1 <= days <= 365:
        raise HTTPException(400, "만회 목표 일수는 1~365일입니다")
    costs = {str(k): float(v) for k, v in (body.get("costs") or {}).items() if v not in (None, "")}
    return services.recovery(uid, days, costs, float(body.get("max_ratio") or 0.3), body.get("exclude") or [])


# ---- 베이스라인·EVM·자원
@app.get("/api/uploads/{uid}/baselines")
def list_baselines(uid: str):
    return services.baselines(uid)


@app.post("/api/uploads/{uid}/baselines")
def add_baseline(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    src = body.get("upload_id") or uid
    if services.project_name(src) != _name(uid):
        raise HTTPException(400, "같은 프로젝트의 업로드만 베이스라인으로 지정할 수 있습니다")
    rid = storage.rec_put("baseline", _name(uid), {"upload_id": src, "label": str(body.get("label") or "베이스라인")[:60],
                                                   "data_date": services.result(src)["data_date"]}, user)
    return {"id": rid}


@app.delete("/api/uploads/{uid}/baselines/{bid}")
def del_baseline(uid: str, bid: str):
    r = storage.rec_get("baseline", bid)
    if not r or r["scope"] != _name(uid):
        raise HTTPException(404)
    storage.rec_del("baseline", bid)
    return {"ok": True}


@app.get("/api/uploads/{uid}/variance")
def variance(uid: str, baseline: str | None = None):
    return services.variance(uid, baseline)


@app.get("/api/uploads/{uid}/evm")
def evm(uid: str, baseline: str | None = None):
    return services.evm(uid, baseline)


@app.get("/api/uploads/{uid}/resources")
def resources(uid: str):
    return services.resources(uid)


# ---- 국내 기준
@app.get("/api/uploads/{uid}/korea")
def korea(uid: str):
    return services.korea_check(uid)


# ---- 학습 기반 예측
@app.get("/api/uploads/{uid}/prediction")
def prediction(uid: str):
    return services.prediction(uid)


# ---- 룩어헤드·PPC·제약
@app.get("/api/uploads/{uid}/lookahead")
def lookahead(uid: str, weeks: int = 3):
    return services.lookahead_board(uid, max(1, min(weeks, 6)))


@app.get("/api/uploads/{uid}/ppc")
def ppc(uid: str):
    return services.ppc(_name(uid))


def _rec_body(kind: str, body: dict) -> dict:
    if kind == "commit":
        keys = ("week", "code", "name", "company", "done", "reason", "note")
        x = {k: body.get(k) for k in keys}
        date.fromisoformat(x["week"])
        x["done"] = bool(x["done"])
    else:
        keys = ("code", "type", "desc", "owner", "due", "status")
        x = {k: body.get(k) for k in keys}
        if x.get("due"):
            date.fromisoformat(x["due"])
        x["status"] = x["status"] if x["status"] in ("미해결", "진행", "해결") else "미해결"
    return {k: (str(v)[:300] if isinstance(v, str) else v) for k, v in x.items()}


@app.post("/api/uploads/{uid}/records/{kind}")
def put_record(uid: str, kind: str, body: dict = Body(...), user: str = Depends(_user)):
    if kind not in ("commit", "constraint"):
        raise HTTPException(404)
    try:
        x = _rec_body(kind, body)
    except (ValueError, TypeError):
        raise HTTPException(400, "날짜 형식을 확인하세요")
    rid = body.get("id")
    if rid:
        old = storage.rec_get(kind, rid)
        if not old or old["scope"] != _name(uid):
            raise HTTPException(404)
    return {"id": storage.rec_put(kind, _name(uid), x, user, rid=rid)}


@app.delete("/api/uploads/{uid}/records/{kind}/{rid}")
def del_record(uid: str, kind: str, rid: str):
    r = storage.rec_get(kind, rid)
    if kind not in ("commit", "constraint") or not r or r["scope"] != _name(uid):
        raise HTTPException(404)
    storage.rec_del(kind, rid)
    return {"ok": True}


# ---- 초기 공정표 생성
@app.get("/api/templates")
def templates():
    from .importers import TEMPLATES
    return [{"key": k, "name": v["name"], "activities": len(v["items"])} for k, v in TEMPLATES.items()]


@app.post("/api/generate")
async def generate(request: Request, project: str = Form(...), start: str = Form(...), mode: str = Form("template"),
                   template: str = Form("building"), scale: float = Form(1.0), target_days: str = Form(""),
                   text: str = Form(""), file: UploadFile | None = File(None)):
    from .importers import TEMPLATES, from_template, tables_to_xer
    user = request.state.user["username"]
    try:
        d0 = date.fromisoformat(start)
    except ValueError:
        raise HTTPException(400, "착공일 형식을 확인하세요")
    project = project.strip()[:60] or "새 프로젝트"
    assumptions = []
    if mode == "ai":
        body = text
        if file is not None:
            raw = await file.read()
            if len(raw) > 20 * 1024 * 1024:
                raise HTTPException(413, "문서는 20MB 이하만 가능합니다")
            body = (body + "\n" + services.extract_text(file.filename, raw)).strip()
        if len(body) < 50:
            raise HTTPException(400, "문서 내용이 너무 짧습니다")
        g = services.generate_from_text(project, d0, body, int(target_days) if target_days.isdigit() else None, user)
        tables, assumptions = g["tables"], g["assumptions"]
    else:
        if template not in TEMPLATES:
            raise HTTPException(400, "템플릿을 선택하세요")
        tables = from_template(template, project, d0, max(0.3, min(scale, 3.0)))
    raw = tables_to_xer(tables)
    result = analyze(Schedule(parse_xer(raw), "1"))
    uid = storage.save(f"{project}_초기공정표.xer", "1", result["name"], user or "익명",
                       "AI 생성 초안" if mode == "ai" else "템플릿 생성", raw, result)
    return {"id": uid, "assumptions": assumptions}


# ---- 관리자
@app.get("/api/admin/users")
def admin_users():
    return auth_mod.list_users()


@app.post("/api/admin/users")
def admin_add_user(body: dict = Body(...)):
    try:
        auth_mod.create_user(body.get("username", ""), body.get("password", ""), body.get("role", "viewer"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@app.put("/api/admin/users/{username}")
def admin_update_user(username: str, request: Request, body: dict = Body(...)):
    if username == request.state.user["username"] and (body.get("active") is False or body.get("role") not in (None, "admin")):
        raise HTTPException(400, "자기 자신의 관리자 권한은 해제할 수 없습니다")
    try:
        auth_mod.update_user(username, body.get("role"), body.get("active"), body.get("password") or None)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@app.get("/api/admin/audit")
def admin_audit(limit: int = 300):
    return storage.audit_list(min(limit, 2000))


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"))


app.mount("/static", StaticFiles(directory=STATIC), name="static")
