"""웹 서버 (FastAPI)."""
from __future__ import annotations

import csv
import io
import json
import os
import re
from datetime import date

from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from urllib.parse import unquote

from . import access, ai, auth as auth_mod, notify, services, storage, workflow
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
access.init()
notify.init()
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
app.add_middleware(GZipMiddleware, minimum_size=2000)   # 대형 분석 결과(수 MB) 전송량 축소
SECURE_COOKIE = os.environ.get("SECURE_COOKIE", "0") == "1"

PUBLIC = {"/api/config", "/api/login", "/api/logout", "/api/me"}
# 조회 권한(viewer)으로도 허용되는 계산 전용 POST
VIEWER_POST = ("/whatif", "/recovery", "/api/reports/render", "/api/reports/preview", "/outputs/log")
ADMIN_ONLY = ("/api/admin/",)


# 프로젝트 데이터를 바꾸지 않는 POST (계산·추출·다운로드만): 프로젝트 쓰기 권한 검사에서 제외
READONLY_POST = VIEWER_POST + ("/chat", "/daily", "/risks/extract", "/xer_patch")
# 읽기 사용자도 남길 수 있는 협업 기록(코멘트)
SOCIAL = re.compile(r"^/api/uploads/[^/]+/comments(/[^/]+(/resolve)?)?$")


def _project_of(method: str, path: str) -> str | None:
    """쓰기 요청이 속한 프로젝트 이름 (없으면 None = 프로젝트 무관)."""
    m = re.match(r"^/api/uploads/([^/]+)", path)
    if m:
        d = storage.get(m.group(1))
        return d["name"] if d else None
    m = re.match(r"^/api/scenarios/([^/]+)$", path)
    if m:
        sc = storage.get_scenario(m.group(1))
        d = storage.get(sc["upload_id"]) if sc else None
        return d["name"] if d else None
    m = re.match(r"^/api/photos/([^/]+)$", path)
    if m and method == "DELETE":
        f = storage.file_get(m.group(1))
        return f["scope"] if f else None
    m = re.match(r"^/api/projects/(.+)/members", path)
    if m:
        from urllib.parse import unquote as _uq
        return _uq(m.group(1))
    return None


def _required_role(method: str, path: str) -> str:
    if any(path.startswith(p) for p in ADMIN_ONLY):
        return "admin"
    if path.startswith("/api/settings/team"):
        return "admin" if method != "GET" else "viewer"
    if method == "GET" or (method == "POST" and path.endswith(VIEWER_POST)) or SOCIAL.match(path) \
            or path in ("/api/learn/progress", "/api/learn/sample", "/api/me/password", "/api/me/prefs"):
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
    # 프로젝트 단위 쓰기 권한: 읽기는 모두, 쓰기는 자기 프로젝트만
    if auth_mod.users_exist() and request.method in ("POST", "PUT", "DELETE") and not path.endswith(READONLY_POST) \
            and not SOCIAL.match(path):
        proj = _project_of(request.method, path)
        if proj is not None:
            members_path = "/members" in path
            delete_upload = request.method == "DELETE" and re.fullmatch(r"/api/uploads/[^/]+", path)
            ok = access.can_manage(user, proj) if (members_path or delete_upload) else access.can_write(user, proj)
            if not ok:
                storage.audit(user["username"], request.method, path, 403, f"프로젝트 권한 없음: {proj}")
                return JSONResponse({"detail": f"'{proj}' 프로젝트에 대한 쓰기 권한이 없습니다. 프로젝트 소유자나 관리자에게 멤버 추가를 요청하세요."},
                                    status_code=403)
    request.state.user = user
    resp = await call_next(request)
    if request.method in ("POST", "PUT", "DELETE") and not path.endswith(VIEWER_POST):
        storage.audit(user["username"], request.method, path, resp.status_code)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Cache-Control", "no-store")
    return resp


def auth():  # 인증·권한은 미들웨어에서 처리 (하위 호환용)
    return None


def _user(request: Request) -> str:
    u = getattr(request.state, "user", None)
    return (u or {}).get("username", "")


@app.get("/api/config")
def config():
    from . import mpp_convert
    return {"mpp": mpp_convert.available(), "token_required": bool(APP_TOKEN) and not auth_mod.users_exist(), "login_required": auth_mod.users_exist(),
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
    return {**u, "mode": "users", "projects": access.projects_of(u["username"])}


@app.post("/api/me/password")
def change_password(request: Request, body: dict = Body(...)):
    """본인 비밀번호 변경 (현재 비밀번호 확인)."""
    if not auth_mod.users_exist():
        raise HTTPException(400, "사용자 계정 모드가 아닙니다")
    u = request.state.user
    if not auth_mod.check_password(u["username"], str(body.get("current", ""))):
        raise HTTPException(400, "현재 비밀번호가 올바르지 않습니다")
    try:
        auth_mod.update_user(u["username"], pw=str(body.get("new", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "relogin": True}


@app.post("/api/upload", dependencies=[Depends(auth)])
async def upload(request: Request, file: UploadFile = File(...), uploader: str = Form(""), note: str = Form("")):
    raw = await file.read()
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "파일이 너무 큽니다")
    if auth_mod.users_exist():
        uploader = request.state.user["username"]
    fname = file.filename or "upload.xer"
    import_report = None
    try:
        low = fname.lower()
        ext = os.path.splitext(low)[1]
        if ext in (".xml", ".mpp", ".mpt", ".mpx"):
            from . import mpp_convert
            from .importers import msp_xml_to_tables, tables_to_xer
            source = "MS Project XML"
            if ext != ".xml":
                raw = mpp_convert.convert(raw, ext)
                source = {".mpp": "MS Project(.mpp)", ".mpt": "MS Project 템플릿(.mpt)", ".mpx": "MPX"}[ext]
            elif b"APIBusinessObjects" in raw[:4000]:
                raw = mpp_convert.convert(raw, ".xml")
                source = "Primavera P6 XML"
            import_report = {"source": source}
            raw = tables_to_xer(msp_xml_to_tables(raw, import_report))
            fname = re.sub(r"\.(xml|mpp|mpt|mpx)$", "", fname, flags=re.I) + "_변환.xer"
        tables = parse_xer(raw)
        projects = list_projects(tables)
        if not projects:
            raise ValueError("PROJECT 테이블이 없습니다")
        ids = []
        if auth_mod.users_exist():
            for p in projects:
                if access.project_exists(p["name"]) and not access.can_write(request.state.user, p["name"]):
                    raise HTTPException(403, f"'{p['name']}' 프로젝트에 대한 쓰기 권한이 없어 업데이트를 올릴 수 없습니다.")
        for p in projects:
            try:
                s = Schedule(tables, p["proj_id"], services.sched_options(p["name"]))
            except ValueError:
                continue
            result = analyze(s)
            is_new = not access.project_exists(result["name"])
            ids.append(storage.save(fname, p["proj_id"], result["name"],
                                    uploader.strip() or "익명", note.strip(), raw, result))
            if is_new and auth_mod.users_exist():
                access.claim_new(result["name"], request.state.user["username"])
            if import_report:
                storage.set_extra(ids[-1], "import_report", import_report)
            if not is_new and auth_mod.users_exist():
                notify.push(notify.project_people(result["name"]), "new_update",
                            f"'{result['name']}' 새 업데이트(DD {result['data_date']})를 {request.state.user['username']} 님이 올렸습니다",
                            f"#/wizard/{ids[-1]}", exclude=request.state.user["username"])
        if not ids:
            raise ValueError("분석 가능한 프로젝트(액티비티 포함)가 없습니다")
    except ValueError as e:
        raise HTTPException(400, str(e))
    import threading

    def warm(xs):  # ⑰ 무거운 지표(건전성 점수)를 미리 계산해 첫 화면을 빠르게
        for x in xs:
            try:
                services.health_score(x)
            except Exception:
                pass
    threading.Thread(target=warm, args=(list(ids),), daemon=True).start()
    return {"ids": ids, "import_report": import_report}


@app.get("/api/uploads", dependencies=[Depends(auth)])
def uploads():
    return storage.listing()


@app.get("/api/uploads/{uid}", dependencies=[Depends(auth)])
def get_upload(uid: str, request: Request):
    import hashlib as _h
    with storage.conn() as c:
        row = c.execute("SELECT length(result) n, finish FROM uploads WHERE id=?", (uid,)).fetchone()
    if not row:
        raise HTTPException(404, "없는 데이터입니다")
    user = getattr(request.state, "user", {}) or {}
    etag = '"' + _h.md5(f"{uid}:{row['n']}:{row['finish']}:{user.get('username')}:{user.get('role')}".encode()).hexdigest() + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    lite = request.query_params.get("lite") == "1"
    if lite:
        etag = etag[:-1] + '-lite"'
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={"ETag": etag})
    d = storage.get(uid)
    d.pop("raw", None)
    if lite:  # 대형 공정표: 머리글·상황판용 요약만 먼저 (액티비티·관계는 /activities 로 나중에)
        res = d["result"]
        d["lite"] = True
        d["result"] = {k: v for k, v in res.items() if k not in ("activities", "relationships", "wbs")}
        d["result"]["activity_count"] = len(res.get("activities") or [])
    d["_etag"] = etag
    if auth_mod.users_exist():
        u = request.state.user
        d["my_role"] = access.project_role(u, d["name"])
        d["can_write"] = d["my_role"] is not None
        d["can_manage"] = d["my_role"] in ("admin", "owner")
    else:
        d.update({"my_role": "admin", "can_write": True, "can_manage": True})
    etag = d.pop("_etag")
    return JSONResponse(d, headers={"ETag": etag, "Cache-Control": "private, no-cache"})


@app.delete("/api/uploads/{uid}", dependencies=[Depends(auth)])
def delete_upload(uid: str, user: str = Depends(_user)):
    if not storage.get_raw(uid):
        raise HTTPException(404, "없는 데이터입니다")
    tid = notify.delete_upload(uid, user)
    services._tables.cache_clear()
    return {"ok": True, "trash_id": tid}


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


def _log_output(uid: str, kind: str, user: str) -> None:
    """보고서 센터의 출력물 이력 (Word·CSV·A3 인쇄; 엑셀은 render 에서 기록)."""
    try:
        r = services.result(uid)
        storage.rec_put("report_log", r["name"], {"template": kind, "type": kind, "upload_id": uid, "data_date": r["data_date"], "warnings": []}, user)
    except Exception:
        pass


@app.post("/api/uploads/{uid}/outputs/log")
def output_log(uid: str, body: dict = Body(default={}), user: str = Depends(_user)):
    kind = {"print": "A3 공정표 인쇄"}.get(body.get("kind"))
    if not kind:
        raise HTTPException(400)
    _log_output(uid, kind, user)
    return {"ok": True}


@app.get("/api/uploads/{uid}/activities.csv", dependencies=[Depends(auth)])
def export_csv(uid: str, request: Request):
    d = storage.get(uid)
    if not d:
        raise HTTPException(404)
    _log_output(uid, "CSV 액티비티", _user(request))
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
def delete_scenario(sid: str, user: str = Depends(_user)):
    if not storage.get_scenario(sid):
        raise HTTPException(404)
    return {"ok": True, "trash_id": notify.delete_scenario(sid, user)}


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
def report_docx(uid: str, request: Request):
    rep = storage.get_extra(uid, "report") or services.report(uid, None, False)
    _log_output(uid, "Word 월간 보고서", _user(request))
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
    old = storage.rec_get("risk", body["id"]) if body.get("id") else None
    if old and old["scope"] != _name(uid):
        raise HTTPException(404)
    rid = storage.rec_put("risk", _name(uid), x, user, rid=body.get("id") or None)
    _notify_assignee(uid, x, old, user, "리스크", "risk")
    return {"id": rid}


@app.delete("/api/uploads/{uid}/risks/{rid}")
def del_risk(uid: str, rid: str, user: str = Depends(_user)):
    r = storage.rec_get("risk", rid)
    if not r or r["scope"] != _name(uid):
        raise HTTPException(404)
    return {"ok": True, "trash_id": notify.delete_record("risk", rid, user)}


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
def del_baseline(uid: str, bid: str, user: str = Depends(_user)):
    r = storage.rec_get("baseline", bid)
    if not r or r["scope"] != _name(uid):
        raise HTTPException(404)
    return {"ok": True, "trash_id": notify.delete_record("baseline", bid, user)}


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
        keys = ("code", "type", "desc", "owner", "due", "status", "assignee")
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
    old = None
    if rid:
        old = storage.rec_get(kind, rid)
        if not old or old["scope"] != _name(uid):
            raise HTTPException(404)
    new_id = storage.rec_put(kind, _name(uid), x, user, rid=rid)
    _notify_assignee(uid, x, old, user, "제약" if kind == "constraint" else "약속", "lookahead")
    return {"id": new_id}


def _notify_assignee(uid: str, x: dict, old: dict | None, user: str, label: str, tab: str) -> None:
    a = x.get("assignee")
    if a and a != (old or {}).get("assignee"):
        what = x.get("title") or x.get("desc") or x.get("code") or ""
        notify.push([a], "assigned", f"{user} 님이 '{_name(uid)}' {label} 담당자로 지정했습니다: {str(what)[:60]}" + (f" (기한 {x['due']})" if x.get("due") else ""),
                    f"#/p/{uid}/{tab}", exclude=user)


def _bulk_rows(uid: str, kind: str, rows: list) -> tuple[list, list]:
    valid = {a["code"] for a in services.result(uid)["activities"]}
    ok, errors = [], []
    for i, row in enumerate(rows[:500]):
        try:
            if not isinstance(row, dict):
                raise ValueError("행 형식이 올바르지 않습니다")
            if kind == "risk":
                x = services.clean_risk(row, valid)
            else:
                if kind == "commit" and not row.get("week"):
                    raise ValueError("주(week) 날짜가 필요합니다")
                x = _rec_body(kind, row)
                if x.get("code") and x["code"] not in valid:
                    raise ValueError(f"없는 작업 코드: {x['code']}")
            ok.append(x)
        except (ValueError, TypeError, KeyError) as e:
            errors.append({"row": i + 1, "error": str(e) or "날짜 형식을 확인하세요"})
    return ok, errors


@app.post("/api/uploads/{uid}/bulk/{kind}")
def bulk_records(uid: str, kind: str, body: dict = Body(...), user: str = Depends(_user)):
    """엑셀에서 붙여넣은 여러 행을 한 번에 입력. dry_run=true 이면 검사 결과만 돌려준다."""
    if kind not in ("commit", "constraint", "risk"):
        raise HTTPException(404)
    ok, errors = _bulk_rows(uid, kind, body.get("rows") or [])
    if body.get("dry_run"):
        return {"valid": len(ok), "errors": errors, "preview": ok[:50]}
    ids = []
    for x in ok:
        ids.append(storage.rec_put(kind, _name(uid), x, user))
        _notify_assignee(uid, x, None, user, {"risk": "리스크", "constraint": "제약", "commit": "약속"}[kind], "risk" if kind == "risk" else "lookahead")
    return {"saved": len(ids), "errors": errors, "ids": ids}


@app.delete("/api/uploads/{uid}/records/{kind}/{rid}")
def del_record(uid: str, kind: str, rid: str, user: str = Depends(_user)):
    r = storage.rec_get(kind, rid)
    if kind not in ("commit", "constraint") or not r or r["scope"] != _name(uid):
        raise HTTPException(404)
    return {"ok": True, "trash_id": notify.delete_record(kind, rid, user)}


# ---- 엑셀 양식 리포트
TPL_SCOPE = "__tpl__"


def _tpl_list():
    from .report_samples import BUILTIN
    out = [{"id": f"builtin:{k}", "name": v[0], "desc": v[1], "builtin": True} for k, v in BUILTIN.items()]
    for r in storage.rec_list("report_tpl", "*"):
        out.append({"id": r["id"], "name": r["name"], "desc": r.get("desc", ""), "builtin": False, "author": r["author"],
                    "created_at": r["created_at"], "scan": r.get("scan", {}), "size": r.get("size")})
    return out


def _tpl_bytes(tid: str) -> tuple[bytes, str]:
    from .report_samples import BUILTIN
    if tid.startswith("builtin:"):
        k = tid.split(":", 1)[1]
        if k not in BUILTIN:
            raise HTTPException(404)
        return BUILTIN[k][2](), BUILTIN[k][0]
    r = storage.rec_get("report_tpl", tid)
    if not r:
        raise HTTPException(404, "양식을 찾을 수 없습니다")
    f = storage.file_get(r["file_id"])
    return f["data"], r["name"]


@app.get("/api/reports/templates")
def report_templates():
    return _tpl_list()


@app.get("/api/reports/fields")
def report_fields():
    from .report_context import field_catalog
    return field_catalog()


@app.post("/api/reports/templates")
async def upload_template(request: Request, file: UploadFile = File(...), name: str = Form(""), desc: str = Form("")):
    from . import xlsx_report
    raw = await file.read()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(413, "양식은 20MB 이하만 올릴 수 있습니다")
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(400, "엑셀 통합문서(.xlsx) 파일만 올릴 수 있습니다")
    try:
        sc = xlsx_report.scan(raw)
    except xlsx_report.TemplateError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(400, "엑셀 파일을 읽을 수 없습니다")
    user = request.state.user["username"]
    fid = storage.file_put(TPL_SCOPE, "template", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", raw, user)
    nm = (name or re.sub(r"\.xlsx$", "", file.filename or "양식", flags=re.I)).strip()[:60]
    summary = {"fields": len(sc["found"]), "lists": sc["lists"], "sheets": sc["sheets"], "unknown": sc["unknown"][:50]}
    from datetime import datetime as _dt
    old = next((r for r in storage.rec_list("report_tpl", "*") if r["name"] == nm), None)
    if old:  # 같은 이름이면 새 버전으로 저장하고 이전 버전 보관(최대 10개)
        versions = (old.get("versions") or []) + [{"file_id": old["file_id"], "author": old.get("updated_by") or old["author"],
                                                   "at": old["updated_at"], "size": old.get("size"), "fields": (old.get("scan") or {}).get("fields")}]
        for v in versions[:-10]:
            storage.file_del(v["file_id"])
        rid = storage.rec_put("report_tpl", "*", {"name": nm, "desc": desc.strip()[:200] or old.get("desc", ""), "file_id": fid, "size": len(raw),
                                                  "scan": summary, "versions": versions[-10:], "updated_by": user}, user, rid=old["id"])
        return {"id": rid, "scan": summary, "version": len(versions[-10:]) + 1}
    rid = storage.rec_put("report_tpl", "*", {"name": nm, "desc": desc.strip()[:200], "file_id": fid, "size": len(raw), "scan": summary,
                                              "versions": [], "updated_by": user}, user)
    return {"id": rid, "scan": summary, "version": 1}


@app.get("/api/reports/templates/{tid}/versions")
def template_versions(tid: str):
    r = storage.rec_get("report_tpl", tid)
    if not r:
        raise HTTPException(404)
    cur = {"file_id": r["file_id"], "current": True, "author": r.get("updated_by"), "size": r.get("size"),
           "fields": (r.get("scan") or {}).get("fields")}
    return [cur] + list(reversed(r.get("versions") or []))


@app.post("/api/reports/templates/{tid}/restore")
def template_restore(tid: str, request: Request, body: dict = Body(...)):
    from . import xlsx_report
    r = storage.rec_get("report_tpl", tid)
    if not r:
        raise HTTPException(404)
    vs = r.get("versions") or []
    v = next((x for x in vs if x["file_id"] == body.get("file_id")), None)
    if not v:
        raise HTTPException(404, "버전을 찾을 수 없습니다")
    sc = xlsx_report.scan(storage.file_get(v["file_id"])["data"])
    rest = [x for x in vs if x["file_id"] != v["file_id"]] + [{"file_id": r["file_id"], "author": r.get("updated_by"), "at": "", "size": r.get("size"),
                                                               "fields": (r.get("scan") or {}).get("fields")}]
    data = {k: r[k] for k in ("name", "desc") if k in r}
    storage.rec_put("report_tpl", "*", {**data, "file_id": v["file_id"], "size": v.get("size"),
                                        "scan": {"fields": len(sc["found"]), "lists": sc["lists"], "sheets": sc["sheets"], "unknown": sc["unknown"][:50]},
                                        "versions": rest[-10:], "updated_by": request.state.user["username"]}, request.state.user["username"], rid=tid)
    return {"ok": True}


@app.post("/api/reports/preview")
def report_preview(request: Request, body: dict = Body(...)):
    """내려받기 전 미리보기: 시트별 앞부분 값과 경고·알 수 없는 필드 위치."""
    import io as _io

    import openpyxl
    from . import xlsx_report
    from .report_context import Context
    tid, uid = str(body.get("template_id") or ""), str(body.get("upload_id") or "")
    if not storage.get_raw(uid):
        raise HTTPException(404, "프로젝트를 선택하세요")
    raw, tname = _tpl_bytes(tid)
    sc = xlsx_report.scan(raw)
    out, warnings, stats = xlsx_report.render(raw, Context(uid, request.state.user["username"], False, body.get("base") or None))
    wb = openpyxl.load_workbook(_io.BytesIO(out), data_only=False)
    sheets = []
    for ws in wb.worksheets[:12]:
        mr, mc = min(ws.max_row, 60), min(ws.max_column, 14)
        rows = []
        for r in ws.iter_rows(min_row=1, max_row=mr, max_col=mc):
            rows.append([("" if c.value is None else c.value.strftime("%Y-%m-%d") if hasattr(c.value, "strftime") else str(c.value))[:60] for c in r])
        sheets.append({"name": ws.title, "rows": rows, "more_rows": max(0, ws.max_row - mr), "more_cols": max(0, ws.max_column - mc)})
    return {"template": tname, "sheets": sheets, "warnings": warnings, "stats": stats,
            "unknown": [{"sheet": u["sheet"], "cell": u["cell"], "expr": u["expr"]} for u in sc["unknown"]]}


@app.delete("/api/reports/templates/{tid}")
def delete_template(tid: str):
    r = storage.rec_get("report_tpl", tid)
    if not r:
        raise HTTPException(404)
    storage.file_del(r["file_id"])
    storage.rec_del("report_tpl", tid)
    return {"ok": True}


@app.get("/api/reports/templates/{tid}/file")
def template_file(tid: str):
    data, name = _tpl_bytes(tid)
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_q(name + '.xlsx')}"})


@app.post("/api/reports/render")
def render_report(request: Request, body: dict = Body(...)):
    from . import xlsx_report
    from .report_context import Context
    tid, uid = str(body.get("template_id") or ""), str(body.get("upload_id") or "")
    user = request.state.user
    use_ai = bool(body.get("ai"))
    if use_ai and auth_mod.ROLES[user["role"]] < auth_mod.ROLES["editor"]:
        raise HTTPException(403, "AI 문장 작성은 편집 권한 이상만 쓸 수 있습니다")
    if not storage.get_raw(uid):
        raise HTTPException(404, "프로젝트를 선택하세요")
    raw, tname = _tpl_bytes(tid)
    try:
        out, warnings, stats = xlsx_report.render(raw, Context(uid, user["username"], use_ai, body.get("base") or None))
    except xlsx_report.TemplateError as e:
        raise HTTPException(400, str(e))
    r = services.result(uid)
    storage.rec_put("report_log", r["name"], {"template": tname, "type": "엑셀 양식", "upload_id": uid, "data_date": r["data_date"],
                                             "warnings": warnings[:20], "stats": stats}, user["username"])
    storage.audit(user["username"], "POST", "/api/reports/render", 200, f"{tname} / {r['name']} {r['data_date']}")
    fname = f"{r['name']}_{tname}_{r['data_date']}.xlsx"
    from urllib.parse import quote as _quote
    return Response(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_q(fname)}",
                             "X-Report-Warnings": _quote(json.dumps(warnings, ensure_ascii=False)),
                             "X-Report-Stats": _quote(json.dumps(stats)),
                             "Access-Control-Expose-Headers": "X-Report-Warnings, X-Report-Stats"})


@app.get("/api/reports/history")
def report_history():
    out = []
    for p in storage.latest_by_project():
        out += [{**x, "project": p["name"]} for x in storage.rec_list("report_log", p["name"])]
    return sorted(out, key=lambda x: x["created_at"], reverse=True)[:100]


# ---- 3차: UX 지원
@app.get("/api/inbox")
def inbox(user: str = Depends(_user)):
    return services.inbox(user)


@app.get("/api/uploads/{uid}/views")
def list_views(uid: str):
    return storage.rec_list("view", _name(uid))


@app.post("/api/uploads/{uid}/views")
def save_view(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    cfg = body.get("config") or {}
    if not isinstance(cfg, dict) or len(json.dumps(cfg)) > 4000:
        raise HTTPException(400, "보기 설정이 올바르지 않습니다")
    name = str(body.get("name") or "").strip()[:40]
    if not name:
        raise HTTPException(400, "보기 이름을 입력하세요")
    return {"id": storage.rec_put("view", _name(uid), {"name": name, "config": cfg}, user)}


@app.delete("/api/uploads/{uid}/views/{vid}")
def del_view(uid: str, vid: str, user: str = Depends(_user)):
    r = storage.rec_get("view", vid)
    if not r or r["scope"] != _name(uid):
        raise HTTPException(404)
    return {"ok": True, "trash_id": notify.delete_record("view", vid, user)}


IMAGE_MAGIC = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png", b"RIFF": "image/webp"}


@app.post("/api/uploads/{uid}/photos")
async def upload_photo(uid: str, request: Request, ref: str = Form(...), file: UploadFile = File(...)):
    raw = await file.read()
    if len(raw) > 3 * 1024 * 1024:
        raise HTTPException(413, "사진은 3MB 이하만 올릴 수 있습니다")
    mime = next((m for sig, m in IMAGE_MAGIC.items() if raw.startswith(sig)), None)
    if mime == "image/webp" and raw[8:12] != b"WEBP":
        mime = None
    if not mime:
        raise HTTPException(400, "JPG, PNG, WEBP 이미지만 올릴 수 있습니다")
    fid = storage.file_put(_name(uid), str(ref)[:60], mime, raw, request.state.user["username"])
    return {"id": fid}


@app.get("/api/uploads/{uid}/photos")
def list_photos(uid: str, ref: str | None = None):
    return storage.file_list(_name(uid), ref)


@app.get("/api/photos/{fid}")
def get_photo(fid: str):
    f = storage.file_get(fid)
    if not f:
        raise HTTPException(404)
    return Response(f["data"], media_type=f["mime"], headers={"Content-Disposition": "inline", "Cache-Control": "private, max-age=3600"})


@app.delete("/api/photos/{fid}")
def del_photo(fid: str):
    if not storage.file_del(fid):
        raise HTTPException(404)
    return {"ok": True}


def _learner(request: Request, client_id: str = "") -> str:
    u = request.state.user
    if auth_mod.users_exist():
        return u["username"]
    return "anon:" + (re.sub(r"[^A-Za-z0-9-]", "", client_id)[:40] or "default")


@app.get("/api/learn/progress")
def learn_progress(request: Request, client_id: str = ""):
    r = storage.rec_get("learn", _learner(request, client_id))
    return (r or {}).get("data", {})


@app.put("/api/learn/progress")
def put_learn_progress(request: Request, body: dict = Body(...), client_id: str = ""):
    data = body.get("data") or {}
    if not isinstance(data, dict) or len(json.dumps(data)) > 20000:
        raise HTTPException(400, "진도 데이터가 올바르지 않습니다")
    who = _learner(request, client_id)
    storage.rec_put("learn", who, {"data": data, "display": request.state.user["username"]}, who, rid=who)
    return {"ok": True}


@app.post("/api/learn/sample")
def learn_sample(user: str = Depends(_user)):
    return {"id": services.learn_sample(user)}


@app.get("/api/admin/learn")
def admin_learn():
    rows = []
    for r in storage.rec_list("learn"):
        d = r.get("data") or {}
        rows.append({"learner": r.get("display") or r["scope"], "lessons_done": len(d.get("done", [])),
                     "quiz": d.get("quiz", {}), "updated_at": r["updated_at"]})
    return rows


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
    if auth_mod.users_exist() and access.project_exists(project) and not access.can_write(request.state.user, project):
        raise HTTPException(403, f"'{project}' 프로젝트에 대한 쓰기 권한이 없습니다. 다른 이름을 쓰세요.")
    raw = tables_to_xer(tables)
    result = analyze(Schedule(parse_xer(raw), "1"))
    if auth_mod.users_exist() and not access.project_exists(result["name"]):
        access.claim_new(result["name"], user)
    uid = storage.save(f"{project}_초기공정표.xer", "1", result["name"], user or "익명",
                       "AI 생성 초안" if mode == "ai" else "템플릿 생성", raw, result)
    return {"id": uid, "assumptions": assumptions}


# ---- 프로젝트 권한(멤버)
@app.get("/api/uploads/{uid}/perm")
def upload_perm(uid: str, request: Request):
    """현재 사용자의 이 프로젝트 권한 (화면 캐시와 별도로 매번 확인)."""
    d = storage.get(uid)
    if not d:
        raise HTTPException(404)
    if not auth_mod.users_exist():
        return {"my_role": "admin", "can_write": True, "can_manage": True}
    role = access.project_role(request.state.user, d["name"])
    return {"my_role": role, "can_write": role is not None, "can_manage": role in ("admin", "owner")}


@app.get("/api/projects")
def list_projects_access(request: Request):
    """모든 프로젝트와 멤버, 내 권한."""
    u = request.state.user
    out = []
    for p in storage.latest_by_project():
        ms = access.members(p["name"]) if auth_mod.users_exist() else []
        role = access.project_role(u, p["name"]) if auth_mod.users_exist() else "admin"
        out.append({"name": p["name"], "latest_id": p["id"], "data_date": p["data_date"], "members": ms,
                    "my_role": role, "can_write": role is not None, "can_manage": role in ("admin", "owner")})
    return out


@app.get("/api/projects/{name}/members")
def get_members(name: str):
    return access.members(name)


@app.post("/api/projects/{name}/members")
def add_member(name: str, request: Request, body: dict = Body(...)):
    if not access.project_exists(name):
        raise HTTPException(404, "없는 프로젝트입니다")
    try:
        access.set_member(name, str(body.get("username", "")), str(body.get("role", "member")), request.state.user["username"])
    except ValueError as e:
        raise HTTPException(400, str(e))
    notify.push([str(body.get("username", ""))], "member", f"'{name}' 프로젝트 {'소유자' if body.get('role') == 'owner' else '멤버'}로 지정되었습니다 ({request.state.user['username']})",
                "#/projects", exclude=request.state.user["username"])
    return access.members(name)


@app.delete("/api/projects/{name}/members/{username}")
def del_member(name: str, username: str, user: str = Depends(_user)):
    try:
        access.remove_member(name, username)
    except ValueError as e:
        raise HTTPException(400, str(e))
    notify.push([username], "member", f"'{name}' 프로젝트 편집 권한이 해제되었습니다 ({user})", "#/projects", exclude=user)
    return access.members(name)


@app.get("/api/users")
def user_names():
    """멤버 지정용 활성 사용자 목록(아이디·역할만)."""
    return [{"username": u["username"], "role": u["role"]} for u in auth_mod.list_users() if u["active"]]


# ---- 상황판·준비도·월간 점검
@app.get("/api/uploads/{uid}/situation")
def situation(uid: str, base: str | None = None):
    return workflow.situation(uid, base)


@app.get("/api/uploads/{uid}/readiness")
def readiness(uid: str):
    return workflow.readiness(uid)


@app.get("/api/uploads/{uid}/review")
def review(uid: str, base: str | None = None):
    d = workflow.review(uid, base)
    d["signoff"] = workflow.signoffs(uid)
    return d


@app.post("/api/uploads/{uid}/review/sign")
def review_sign(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    keys = [s["key"] for s in workflow.review(uid, None)["steps"]]
    if body.get("key") not in keys:
        raise HTTPException(400, "없는 점검 단계입니다")
    return workflow.sign(uid, body["key"], str(body.get("note") or ""), user, keys)


@app.get("/api/uploads/{uid}/activities")
def activities(uid: str):
    r = services.result(uid)
    return {k: r.get(k) for k in ("activities", "relationships", "wbs")}


# ---- 코멘트·@멘션 (읽기 사용자도 가능)
def _mentions(text: str) -> list[str]:
    names = {u["username"] for u in auth_mod.list_users() if u["active"]} if auth_mod.users_exist() else set()
    found = re.findall(r"@([\w.\-가-힣]+)", text)
    return [n for n in dict.fromkeys(found) if n in names]


@app.get("/api/uploads/{uid}/comments")
def list_comments(uid: str, target: str | None = None):
    items = storage.rec_list("comment", _name(uid))
    if target:
        items = [c for c in items if c.get("target") == target]
    return items


@app.post("/api/uploads/{uid}/comments")
def add_comment(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    text = str(body.get("text") or "").strip()[:2000]
    target = str(body.get("target") or "")[:80]
    if not text or not re.fullmatch(r"(activity|risk|project):.+", target):
        raise HTTPException(400, "내용과 대상을 확인하세요")
    ments = _mentions(text)
    cid = storage.rec_put("comment", _name(uid), {"target": target, "text": text, "mentions": ments, "resolved": False}, user)
    kind, ref = target.split(":", 1)
    where = {"activity": f"작업 {ref}", "risk": "리스크", "project": "프로젝트"}[kind]
    notify.push(ments, "mention", f"{user} 님이 '{_name(uid)}' {where} 코멘트에서 회원님을 언급했습니다: {text[:80]}",
                f"#/p/{uid}/{'risk' if kind == 'risk' else 'overview'}?c={cid}", exclude=user)
    return {"id": cid, "mentions": ments}


@app.post("/api/uploads/{uid}/comments/{cid}/resolve")
def resolve_comment(uid: str, cid: str, request: Request, body: dict = Body(default={}), user: str = Depends(_user)):
    c = storage.rec_get("comment", cid)
    if not c or c["scope"] != _name(uid):
        raise HTTPException(404)
    u = request.state.user
    if not (user in (c.get("mentions") or []) or _comment_author(cid) == user or access.can_write(u, c["scope"])):
        raise HTTPException(403, "작성자·언급된 사람·프로젝트 멤버만 해결 표시할 수 있습니다")
    c["resolved"] = bool(body.get("resolved", True))
    c["resolved_by"] = user if c["resolved"] else None
    storage.rec_put("comment", c["scope"], c, user, rid=cid)
    return {"ok": True}


def _comment_author(cid: str) -> str:
    with storage.conn() as c:
        r = c.execute("SELECT author FROM records WHERE kind='comment' AND id=?", (cid,)).fetchone()
    return r["author"] if r else ""


@app.delete("/api/uploads/{uid}/comments/{cid}")
def delete_comment(uid: str, cid: str, request: Request, user: str = Depends(_user)):
    c = storage.rec_get("comment", cid)
    if not c or c["scope"] != _name(uid):
        raise HTTPException(404)
    if _comment_author(cid) != user and request.state.user.get("role") != "admin":
        raise HTTPException(403, "작성자만 지울 수 있습니다")
    storage.rec_del("comment", cid)
    return {"ok": True}


# ---- 내게 배정된 일·사용자 설정
@app.get("/api/my/tasks")
def my_tasks(user: str = Depends(_user)):
    return workflow.my_tasks(user)


@app.get("/api/me/prefs")
def get_prefs(user: str = Depends(_user)):
    return {**notify.prefs(user), "types": notify.NOTIFY_TYPES}


@app.put("/api/me/prefs")
def put_prefs(body: dict = Body(...), user: str = Depends(_user)):
    return notify.set_prefs(user, body)


# ---- 알림
@app.get("/api/notifications")
def notifications(user: str = Depends(_user)):
    return notify.listing(user)


@app.post("/api/notifications/read")
def notifications_read(body: dict = Body(default={}), user: str = Depends(_user)):
    notify.mark_read(user, body.get("ids"))
    return {"ok": True}


# ---- 편집 권한 요청
@app.post("/api/projects/{name}/access-request")
def access_request(name: str, request: Request, body: dict = Body(default={})):
    u = request.state.user
    if not auth_mod.users_exist():
        raise HTTPException(400, "사용자 계정 모드가 아닙니다")
    if not access.project_exists(name):
        raise HTTPException(404)
    if access.can_write(u, name):
        raise HTTPException(400, "이미 편집 권한이 있습니다")
    return {"id": notify.request_access(name, u["username"], str(body.get("message") or ""))}


@app.get("/api/projects/{name}/access-requests")
def access_requests(name: str, request: Request):
    if not access.can_manage(request.state.user, name):
        raise HTTPException(403, "소유자나 관리자만 볼 수 있습니다")
    return notify.requests_for(name)


@app.post("/api/projects/{name}/access-requests/{rid}")
def decide_access(name: str, rid: str, request: Request, body: dict = Body(...)):
    if not access.can_manage(request.state.user, name):
        raise HTTPException(403, "소유자나 관리자만 처리할 수 있습니다")
    try:
        return notify.decide(name, rid, bool(body.get("approve")), request.state.user["username"], str(body.get("role") or "member"))
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---- 휴지통(되돌리기)
@app.post("/api/trash/{tid}/restore")
def trash_restore(tid: str, request: Request):
    t = notify.get(tid)
    if not t:
        raise HTTPException(404, "되돌릴 항목이 없습니다(보관 기간 7일)")
    if auth_mod.users_exist() and t["project"] and not access.can_write(request.state.user, t["project"]):
        raise HTTPException(403, "이 프로젝트에 대한 쓰기 권한이 없습니다")
    out = notify.restore(tid)
    services._tables.cache_clear()
    return out


@app.get("/api/trash")
def trash_list(project: str | None = None):
    return notify.recent(project)


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
