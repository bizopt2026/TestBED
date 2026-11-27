"""웹 서버 (FastAPI)."""
from __future__ import annotations

import csv
import io
import json
import os
import re
import subprocess
from datetime import date

from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from urllib.parse import unquote

from . import access, ai, auth as auth_mod, edition, notify, services, storage, workflow
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
VIEWER_POST = ("/whatif", "/recovery", "/api/reports/render", "/api/reports/preview", "/outputs/log", "/api/usage", "/api/dashboard/ask", "/hub-comments")
ADMIN_ONLY = ("/api/admin/",)


# 프로젝트 데이터를 바꾸지 않는 POST (계산·추출·다운로드만): 프로젝트 쓰기 권한 검사에서 제외
READONLY_POST = VIEWER_POST + ("/chat", "/daily", "/risks/extract", "/xer_patch", "/why/ai")
# 읽기 사용자도 남길 수 있는 협업 기록(코멘트)
SOCIAL = re.compile(r"^/api/uploads/[^/]+/comments(/[^/]+(/resolve)?)?$")


def _project_of(method: str, path: str) -> str | None:
    """쓰기 요청이 속한 프로젝트 이름 (없으면 None = 프로젝트 무관)."""
    m = re.match(r"^/api/uploads/([^/]+)", path)
    if m:
        return storage.name_of(m.group(1))
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
    if re.search(r"/thresholds$", path) and method != "GET":   # 이슈 판정 기준은 관리자만 (PMS 결정)
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
    # 참조 프로젝트는 읽기 전용 (계정 유무와 상관없이). 삭제·멤버 관리·내보내기·복제는 허용
    if request.method in ("POST", "PUT", "DELETE") and not path.endswith(READONLY_POST) and not path.endswith(("/export.pms", "/export.txt", "/clone")):
        proj = _project_of(request.method, path)
        if proj:
            from .package import is_ref
            if is_ref(proj) and not ("/members" in path or (request.method == "DELETE" and re.fullmatch(r"/api/uploads/[^/]+", path))):
                return JSONResponse({"detail": f"'{proj}'는 참조 프로젝트(읽기 전용)입니다. 편집하려면 '내 프로젝트로 복제'를 쓰세요."}, status_code=403)
    request.state.user = user
    m = re.match(r"^/api/uploads/([^/]+)", path)
    ai.set_scope(storage.name_of(m.group(1)) if m else None)   # 프로젝트별 AI 사용 정책
    ai.set_user(user.get("username") or "")
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
def config(request: Request):
    from . import mpp_convert
    signed = not auth_mod.users_exist() or bool(getattr(request.state, "user", None))
    return {"mpp": mpp_convert.available(), "token_required": bool(APP_TOKEN) and not auth_mod.users_exist(), "login_required": auth_mod.users_exist(),
            "ai": ai.status()["enabled"], "version": _version_label() if signed else _version_label().split(" ")[0],   # 로그인 전에는 커밋 해시를 보이지 않음 "today": __import__("app.clock", fromlist=["today"]).today().isoformat(),
            **edition.config()}


_VER = None


def _version_label() -> str:
    global _VER
    if _VER is None:
        from . import updater
        v = updater.version()
        _VER = f"{v['version']}" + (f" ({v['commit']})" if v["commit"] else "")
    return _VER


@app.post("/api/login")
def login(request: Request, body: dict = Body(...)):
    try:
        token = auth_mod.login(str(body.get("username", "")), str(body.get("password", "")), request.client.host if request.client else "")
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
        if edition.EDITION == "server":
            from . import issues
            for x in ids:
                issues.evaluate(x)
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
    buf = services.activities_csv(uid)
    name = f"{d['name']}_{d['data_date']}.csv"
    return Response(buf, media_type="text/csv; charset=utf-8",
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


@app.exception_handler(ValueError)
@app.exception_handler(TypeError)
async def _bad_input(request: Request, e: Exception):
    """입력값 형식 오류는 500 대신 400. 원인은 서버 기록에만 남긴다."""
    import logging
    logging.getLogger("pms").warning("bad input %s %s: %r", request.method, request.url.path, e)
    msg = str(e) if isinstance(e, storage.RecordScopeError) else "입력값 형식이 올바르지 않습니다. 숫자·목록 칸을 확인하세요"
    return JSONResponse({"detail": msg}, status_code=400)


@app.exception_handler(KeyError)
async def _not_found(_: Request, e: Exception):
    return JSONResponse({"detail": "없는 데이터입니다"}, status_code=404)


@app.exception_handler(ai.AIFailed)
async def _ai_failed(_: Request, e: Exception):
    return JSONResponse({"detail": str(e)}, status_code=502)




@app.get("/api/ai/status", dependencies=[Depends(auth)])
def ai_status(uid: str | None = None):
    if uid:
        ai.set_scope(storage.name_of(uid))
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
    ch = body.get("changes") or []
    if not isinstance(ch, list) or not all(isinstance(x, dict) for x in ch):
        raise HTTPException(400, "changes 는 변경 목록이어야 합니다")
    return services.whatif(uid, ch)


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


@app.get("/api/uploads/{uid}/trades/map")
def trades_map(uid: str):
    return services.trade_map(uid)


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
    if (c := _conflict(old, body)) is not None:
        return c
    x["updated_by"] = user
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
    if (c := _conflict(old, body)) is not None:
        return c
    x["updated_by"] = user
    new_id = storage.rec_put(kind, _name(uid), x, user, rid=rid)
    _notify_assignee(uid, x, old, user, "제약" if kind == "constraint" else "약속", "lookahead")
    return {"id": new_id}


def _conflict(old: dict | None, body: dict):
    """동시 편집 충돌: 화면을 연 뒤 다른 사람이 먼저 고쳤으면 409로 알린다 (base_updated_at 이 있을 때만)."""
    base = body.get("base_updated_at")
    if old and base and old.get("updated_at") and old["updated_at"] != base:
        return JSONResponse({"detail": {"message": f"{old.get('updated_by') or '다른 사용자'} 님이 {old['updated_at'].replace('T', ' ')[5:16]}에 먼저 수정했습니다",
                                        "updated_by": old.get("updated_by"), "updated_at": old["updated_at"], "conflict": True}}, status_code=409)
    return None


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
    from . import package
    name = storage.name_of(uid)
    if not name:
        raise HTTPException(404)
    ref = package.ref_meta(name)
    if not auth_mod.users_exist():
        return {"my_role": "admin", "can_write": not ref, "can_manage": True, "ref": ref}
    role = access.project_role(request.state.user, name)
    return {"my_role": role, "can_write": role is not None and not ref, "can_manage": role in ("admin", "owner"), "ref": ref}


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


_INDEX = {}


@app.get("/")
def index():
    """index.html 의 정적 파일 주소에 버전을 붙여(?v=), 새 버전이 아니면 브라우저 캐시를 그대로 쓰게 한다."""
    path = os.path.join(STATIC, "index.html")
    mtime = os.path.getmtime(path)
    if _INDEX.get("mtime") != mtime:
        from . import updater
        v = updater.version()
        tag = re.sub(r"[^0-9A-Za-z.]", "", f"{v['version']}.{v['commit'] or int(mtime)}")
        html = open(path, encoding="utf-8").read()
        html = re.sub(r'((?:src|href)="/static/[^"?]+\.(?:js|css))"', rf'\1?v={tag}"', html)
        _INDEX.update(mtime=mtime, html=html)
    return Response(_INDEX["html"], media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-cache"})


@app.middleware("http")
async def static_cache(request: Request, call_next):
    resp = await call_next(request)
    p = request.url.path
    if p.startswith("/static/") and resp.status_code == 200:
        if request.query_params.get("v") or p.startswith("/static/fonts/"):
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            resp.headers["Cache-Control"] = "no-cache"
    return resp


# ---- 8차: 회사 로고 (관리자)
@app.get("/api/logo")
def get_logo():
    lg = services.logo()
    if not lg:
        raise HTTPException(404)
    return Response(lg[0], media_type=lg[1], headers={"Cache-Control": "private, max-age=300"})


@app.post("/api/admin/logo")
async def put_logo(file: UploadFile = File(...), user: str = Depends(_user)):
    raw = await file.read()
    mime = {b"\x89PNG": "image/png", b"\xff\xd8\xff": "image/jpeg"}
    kind = next((m for sig, m in mime.items() if raw.startswith(sig)), None)
    if not kind or len(raw) > 512 * 1024:
        raise HTTPException(400, "PNG 또는 JPG, 512KB 이하 이미지만 올릴 수 있습니다")
    old = storage.setting("*", "logo_file")
    fid = storage.file_put("*", "logo", kind, raw, user)
    storage.set_setting("*", "logo_file", fid, user)
    if old:
        storage.file_del(old)
    return {"ok": True}


@app.delete("/api/admin/logo")
def del_logo(user: str = Depends(_user)):
    old = storage.setting("*", "logo_file")
    if old:
        storage.file_del(old)
    storage.set_setting("*", "logo_file", None, user)
    return {"ok": True}


app.mount("/static", StaticFiles(directory=STATIC), name="static")



# ============================================================ 6차: 타임라인, 상태 기준, '왜?' AI, 보고 패키지·확정본, 사용 현황
@app.get("/api/projects/{name}/timeline")
def project_timeline(name: str):
    if not access.project_exists(name):
        raise HTTPException(404)
    return workflow.timeline(name)


@app.get("/api/uploads/{uid}/thresholds")
def get_thresholds(uid: str):
    return {"values": storage.setting(_name(uid), "status_thresholds", {}) or {}, "defaults": workflow.TH_DEFAULT,
            "effective": workflow.thresholds(_name(uid))}


@app.put("/api/uploads/{uid}/thresholds")
def put_thresholds(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    try:
        v = workflow.clean_thresholds(body)
    except (TypeError, ValueError):
        raise HTTPException(400, "숫자로 입력하세요")
    storage.set_setting(_name(uid), "status_thresholds", v, user)
    return {"values": v}


@app.post("/api/uploads/{uid}/why/ai")
def why_ai(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    if not ai.available():
        raise HTTPException(400, "AI가 설정되어 있지 않습니다 (서버의 Claude CLI)")
    return services.why_ai(uid, str(body.get("key") or ""), user)


def _package(uid: str, tpl: str, user: str, base: str | None):
    raw, tname = _tpl_bytes(tpl or "builtin:monthly")
    return services.package(uid, raw, tname, user, base)


@app.get("/api/uploads/{uid}/package")
def report_package(uid: str, request: Request, tpl: str = "builtin:monthly", base: str | None = None):
    user = _user(request)
    data, _ = _package(uid, tpl, user, base)
    _log_output(uid, "월간 보고 패키지", user)
    r = services.result(uid)
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_q(r['name'] + '_월간보고_' + r['data_date'] + '.zip')}"})


@app.get("/api/uploads/{uid}/a3.html")
def a3_page(uid: str):
    return Response(services.a3_html(uid), media_type="text/html; charset=utf-8")


@app.get("/api/uploads/{uid}/final")
def get_final(uid: str):
    return storage.rec_get("final", uid)


@app.post("/api/uploads/{uid}/final")
def make_final(uid: str, body: dict = Body(default={}), user: str = Depends(_user)):
    """월간 점검을 마친 업데이트의 보고 패키지를 확정본으로 고정 (한 번만)."""
    so = workflow.signoffs(uid)
    if not so.get("completed_by"):
        raise HTTPException(400, "월간 점검 6단계를 모두 확인한 뒤 확정할 수 있습니다")
    if storage.rec_get("final", uid):
        raise HTTPException(409, "이미 확정된 업데이트입니다")
    name = _name(uid)
    data, notes = _package(uid, str(body.get("tpl") or "builtin:monthly"), user, body.get("base"))
    fid = storage.file_put(name, f"final:{uid}", "application/zip", data, user)
    r = services.result(uid)
    storage.rec_put("final", name, {"upload_id": uid, "file_id": fid, "data_date": r["data_date"], "finish": r["finish"],
                                    "by": user, "review_by": so["completed_by"], "size": len(data), "notes": notes[:10]}, user, rid=uid)
    _log_output(uid, "확정본", user)
    notify.push(notify.project_people(name), "review", f"'{name}' DD {r['data_date']} 보고서를 {user} 님이 확정했습니다", f"#/p/{uid}/timeline", exclude=user)
    return storage.rec_get("final", uid)


@app.get("/api/uploads/{uid}/final/download")
def final_download(uid: str):
    f = storage.rec_get("final", uid)
    if not f:
        raise HTTPException(404, "확정본이 없습니다")
    data = storage.file_get(f["file_id"])
    r = services.result(uid)
    return Response(data["data"], media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_q(r['name'] + '_확정본_' + r['data_date'] + '.zip')}"})


@app.post("/api/usage")
def usage_hit(body: dict = Body(...), user: str = Depends(_user)):
    screen = str(body.get("screen") or "")
    if not re.fullmatch(r"[a-z0-9_\-]{1,40}", screen):
        raise HTTPException(400)
    storage.usage_hit(user, screen)
    return {"ok": True}


@app.get("/api/usage/mine")
def usage_mine(user: str = Depends(_user)):
    return storage.usage_mine(user)


@app.get("/api/admin/usage")
def admin_usage():
    """화면별 사용(집계), 월간 점검 단계별 완료, 강의별 완료 수. 개인별 행은 제공하지 않는다."""
    steps: dict[str, int] = {}
    reviews = storage.rec_list("review")
    for r in reviews:
        for k in (r.get("steps") or {}):
            steps[k] = steps.get(k, 0) + 1
    lessons: dict[str, int] = {}
    learners = storage.rec_list("learn")
    for r in learners:
        for lid in (r.get("data") or {}).get("done", []):
            lessons[lid] = lessons.get(lid, 0) + 1
    return {"screens": storage.usage_stats(), "review_steps": steps, "reviews_started": len(reviews),
            "reviews_completed": sum(1 for r in reviews if r.get("completed_by")), "lessons": lessons, "learners": len(learners)}



# ============================================================ 로컬 설치판 버전 관리·업데이트 (관리자)
@app.get("/api/admin/update")
def update_status(force: int = 0):
    from . import updater
    return {**updater.check(force=bool(force)), "launcher": os.environ.get("APP_LAUNCHER") == "1"}


@app.post("/api/admin/update")
def update_apply(user: str = Depends(_user)):
    from . import updater
    try:
        r = updater.apply(by=user)
    except updater.UpdateError as e:
        raise HTTPException(400, str(e))
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "업데이트 시간이 초과되었습니다. 네트워크를 확인하세요")
    r["restarting"] = bool(r["restart"]) and updater.restart_later()
    return r


@app.post("/api/admin/update/rollback")
def update_rollback(user: str = Depends(_user)):
    from . import updater
    try:
        r = updater.rollback(by=user)
    except updater.UpdateError as e:
        raise HTTPException(400, str(e))
    r["restarting"] = updater.restart_later()
    return r



# ============================================================ PMS P0: 전사 이슈 기준·프로젝트별 AI 정책 (관리자)
@app.get("/api/admin/thresholds")
def team_thresholds():
    return {"values": storage.setting("*", "status_thresholds", {}) or {}, "defaults": workflow.TH_DEFAULT}


@app.put("/api/admin/thresholds")
def put_team_thresholds(body: dict = Body(...), user: str = Depends(_user)):
    try:
        v = workflow.clean_thresholds(body)
    except (TypeError, ValueError):
        raise HTTPException(400, "숫자로 입력하세요")
    storage.set_setting("*", "status_thresholds", v, user)
    return {"values": v}


@app.get("/api/admin/ai-policy")
def ai_policies():
    return [{"project": p["name"], "policy": storage.setting(p["name"], "ai_policy", "allow") or "allow"} for p in storage.latest_by_project()]


@app.put("/api/admin/ai-policy")
def put_ai_policy(body: dict = Body(...), user: str = Depends(_user)):
    name, pol = str(body.get("project") or ""), body.get("policy")
    if pol not in ("allow", "forbid") or not access.project_exists(name):
        raise HTTPException(400, "프로젝트와 정책(allow/forbid)을 확인하세요")
    storage.set_setting(name, "ai_policy", pol, user)
    storage.audit(user, "PUT", "/api/admin/ai-policy", 200, f"{name}: {pol}")
    return {"project": name, "policy": pol}



# ============================================================ PMS P1: .pms 패키지 — 파일·붙여넣기 공유, 참조 프로젝트, 복제
@app.get("/api/uploads/{uid}/export.pms")
def export_pms(uid: str, request: Request):
    from . import package
    try:
        data, m = package.build(uid, _user(request))
    except package.PackageError as e:
        raise HTTPException(400, str(e))
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_q(m['project'] + '_v' + str(m['version']) + '_' + m['data_date'] + '.pms')}"})


@app.get("/api/uploads/{uid}/export.txt")
def export_text(uid: str, request: Request):
    from . import package
    try:
        data, m = package.build(uid, _user(request))
        return {"text": package.to_text(data), "project": m["project"], "version": m["version"], "size": len(data)}
    except package.PackageError as e:
        raise HTTPException(400, str(e))


@app.post("/api/import/pms")
async def import_pms(request: Request, file: UploadFile = File(...)):
    from . import package
    raw = await file.read()
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "파일이 너무 큽니다")
    try:
        return package.import_package(raw, _user(request), "file")
    except package.PackageError as e:
        raise HTTPException(400, str(e))
    except ValueError:
        raise HTTPException(400, "패키지 안의 공정표를 읽을 수 없습니다 (손상되었거나 XER 형식이 아님)")


@app.post("/api/import/text")
def import_text(request: Request, body: dict = Body(...)):
    from . import package
    try:
        return package.import_package(package.from_text(str(body.get("text") or "")), _user(request), "paste")
    except package.PackageError as e:
        raise HTTPException(400, str(e))
    except ValueError:
        raise HTTPException(400, "패키지 안의 공정표를 읽을 수 없습니다 (손상되었거나 XER 형식이 아님)")


@app.post("/api/projects/{name}/clone")
def clone_project(name: str, request: Request, body: dict = Body(...)):
    from . import package
    if not access.project_exists(name):
        raise HTTPException(404)
    try:
        return package.clone(name, str(body.get("name") or ""), _user(request))
    except package.PackageError as e:
        raise HTTPException(400, str(e))


# ============================================================ PMS P2: PMS 대시보드 저장소 API (/hub/v1, 기기 토큰)
def _hub_only():
    if edition.EDITION != "server":
        raise HTTPException(404, "PMS 대시보드에서만 쓰는 기능입니다")


def _hub_auth(request: Request):
    from . import hub
    _hub_only()
    try:
        return hub.device_user(request.headers.get("x-pms-device"))
    except hub.HubError as e:
        raise HTTPException(e.status, e.message)


def _hub_call(fn, *a, **kw):
    from . import hub, package
    try:
        return fn(*a, **kw)
    except hub.HubError as e:
        raise HTTPException(e.status, {"message": e.message, **e.extra} if e.extra else e.message)
    except package.PackageError as e:
        raise HTTPException(400, str(e))


def _zip_response(data: bytes, snap: dict):
    return Response(data, media_type="application/zip", headers={"X-PMS-Version": str(snap["version"]), "ETag": f'"{snap["pid"]}-{snap["version"]}"'})


@app.post("/hub/v1/devices")
def hub_register(request: Request, body: dict = Body(...)):
    from . import hub
    _hub_only()
    return _hub_call(hub.register_device, str(body.get("username") or ""), str(body.get("password") or ""), str(body.get("name") or ""),
                     request.client.host if request.client else "")


@app.get("/hub/v1/me")
def hub_me(request: Request):
    u, dev = _hub_auth(request)
    return {**u, "device": dev}


@app.post("/hub/v1/projects/{pid}/snapshots")
async def hub_publish(pid: str, request: Request, note: str = "", take: str = "0"):
    from . import hub
    u, dev = _hub_auth(request)
    data = await request.body()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "패키지가 너무 큽니다")
    r = _hub_call(hub.publish, u, dev, data, note, take == "1")
    if r["pid"] != pid:
        raise HTTPException(400, "주소의 프로젝트 ID와 패키지가 다릅니다")
    return r


@app.get("/hub/v1/projects/{pid}/snapshots")
def hub_snapshots(pid: str, request: Request):
    from . import hub
    u, _ = _hub_auth(request)
    _hub_call(hub.readable_snapshot, u, pid)
    return hub.snapshots_of(pid)


@app.get("/hub/v1/projects/{pid}/snapshots/{ver}")
def hub_snapshot(pid: str, ver: str, request: Request):
    from . import hub
    u, _ = _hub_auth(request)
    s = _hub_call(hub.readable_snapshot, u, pid, None if ver == "latest" else int(ver) if ver.isdigit() else -1)
    return _zip_response(hub.package_bytes(s), s)


@app.get("/hub/v1/projects/{pid}/lock")
def hub_lock(pid: str, request: Request):
    from . import hub
    _hub_auth(request)
    return _hub_call(hub.lock_info, pid)


@app.get("/hub/v1/catalog")
def hub_catalog(request: Request, q: str = ""):
    from . import hub
    u, _ = _hub_auth(request)
    return hub.catalog(u, q)


@app.get("/hub/v1/subscriptions")
def hub_subs(request: Request):
    from . import hub
    u, _ = _hub_auth(request)
    out = []
    for s in hub.subscriptions(u["username"]):
        last = hub.latest(s["pid"])
        if last:
            out.append({"pid": s["pid"], "version": last["version"]})
    return out


@app.post("/hub/v1/subscriptions")
def hub_subscribe(request: Request, body: dict = Body(...)):
    from . import hub
    u, _ = _hub_auth(request)
    _hub_call(hub.subscribe, u, str(body.get("pid") or ""), bool(body.get("on", True)))
    return {"ok": True}


@app.post("/hub/v1/share-codes")
def hub_make_code(request: Request, body: dict = Body(...)):
    from . import hub
    u, _ = _hub_auth(request)
    v = body.get("version")
    return _hub_call(hub.make_code, u, str(body.get("pid") or ""), int(v) if v else None, int(body.get("days") or 7),
                     int(body["max_uses"]) if body.get("max_uses") else None, body.get("target") or None)


@app.get("/hub/v1/share-codes/{code}")
def hub_redeem(code: str, request: Request):
    from . import hub
    u, _ = _hub_auth(request)
    s = _hub_call(hub.redeem, u, code)
    return _zip_response(hub.package_bytes(s), s)


@app.delete("/hub/v1/share-codes/{code}")
def hub_revoke_code(code: str, request: Request):
    from . import hub
    u, _ = _hub_auth(request)
    _hub_call(hub.revoke_code, u, code)
    return {"ok": True}


@app.get("/hub/v1/projects/{pid}/share-codes")
def hub_codes(pid: str, request: Request):
    from . import hub
    u, _ = _hub_auth(request)
    p = hub.project(pid)
    if not p or not hub._can_write(u, p):
        raise HTTPException(403)
    return hub.codes(pid)


@app.post("/hub/v1/ai/run")
def hub_ai(request: Request, body: dict = Body(...)):
    """AI 게이트웨이: PMS 현장의 AI 요청을 서버의 Claude CLI로 실행 (결정: AI는 서버에서만)."""
    from . import hub
    u, _ = _hub_auth(request)
    p = hub.project(str(body.get("pid") or "")) if body.get("pid") else None
    ai.set_scope(p["name"] if p else None)
    if not ai.available():
        raise HTTPException(400, ai.blocked_reason() or "AI를 쓸 수 없습니다")
    kind = body.get("kind")
    try:
        if kind == "complete":
            text, usage = ai.complete(str(body["system"]), str(body["prompt"]), body.get("effort") or "medium", model=body.get("model"))
            out = {"text": text, "usage": usage}
        elif kind == "structured":
            data, usage = ai.structured(str(body["system"]), str(body["prompt"]), body["schema"], body.get("effort") or "low", model=body.get("model"))
            out = {"data": data, "usage": usage}
        elif kind == "tools":
            out = _hub_ai_tools(u["username"], body)
        else:
            raise HTTPException(400, "알 수 없는 AI 요청")
    finally:
        ai.set_scope(None)
    storage.log_ai(None, f"gateway:{body.get('feature') or kind}", u["username"], out.get("usage") or {}, out.get("seconds") or 0, True)
    return out


def _hub_ai_tools(username: str, body: dict) -> dict:
    """도구를 쓰는 AI(어시스턴트): 현장의 작업본 패키지를 잠시 서버에 올려 실행하고 바로 지운다."""
    import base64
    import uuid as _uuid
    from . import package
    tmp = f"__ai_tmp_{_uuid.uuid4().hex[:8]}"
    uid = None
    try:
        uid = package.import_as_project(base64.b64decode(body["package_b64"]), tmp, username, "AI 임시")
        return ai.run_tools(str(body["system"]), str(body["prompt"]), uid, body.get("effort") or "medium")
    finally:
        with storage.conn() as c:
            c.execute("DELETE FROM records WHERE scope=?", (tmp,))
            c.execute("DELETE FROM files WHERE scope=?", (tmp,))
        for h in storage.history(tmp):
            storage.delete(h["id"])
        services._tables.cache_clear()


# ---- PMS 대시보드 관리 화면용 (세션 로그인)
@app.get("/api/dashboard/publish-status")
def dash_publish_status():
    from . import hub
    _hub_only()
    return hub.publish_status()


@app.get("/api/admin/hub/devices")
def hub_devices():
    from . import hub
    _hub_only()
    return hub.devices()


@app.post("/api/admin/hub/devices/{dev_id}/revoke")
def hub_device_revoke(dev_id: str):
    from . import hub
    _hub_only()
    hub.revoke_device(dev_id)
    return {"ok": True}


# ============================================================ PMS P2: PMS 현장 → 대시보드 연결 (/api/hub)
def _hc(fn, *a, **kw):
    from . import hubclient, package
    try:
        return fn(*a, **kw)
    except hubclient.HubClientError as e:
        raise HTTPException(502 if e.status == 0 else e.status, {"message": e.message, **e.extra} if e.extra else e.message)
    except package.PackageError as e:
        raise HTTPException(400, str(e))


@app.get("/api/hub/status")
def hubc_status(user: str = Depends(_user)):
    from . import hubclient
    return {**hubclient.status(user), **edition.config()}


@app.post("/api/hub/connect")
def hubc_connect(body: dict = Body(...), user: str = Depends(_user)):
    from . import hubclient
    return _hc(hubclient.connect, user, str(body.get("url") or ""), str(body.get("username") or ""), str(body.get("password") or ""))


@app.post("/api/hub/disconnect")
def hubc_disconnect(user: str = Depends(_user)):
    from . import hubclient
    hubclient.disconnect(user)
    return {"ok": True}


@app.get("/api/hub/catalog")
def hubc_catalog(q: str = "", user: str = Depends(_user)):
    from . import hubclient
    return _hc(hubclient.call_json, "GET", "/hub/v1/catalog?" + __import__("urllib.parse").parse.urlencode({"q": q}), user)


@app.post("/api/hub/subscribe")
def hubc_subscribe(body: dict = Body(...), user: str = Depends(_user)):
    from . import hubclient
    pid, on = str(body.get("pid") or ""), bool(body.get("on", True))
    _hc(hubclient.call_json, "POST", "/hub/v1/subscriptions", user, {"pid": pid, "on": on})
    return _hc(hubclient.pull, user, pid) if on else {"ok": True}


@app.post("/api/hub/sync")
def hubc_sync(user: str = Depends(_user)):
    from . import hubclient
    return _hc(hubclient.sync, user)


@app.post("/api/hub/redeem")
def hubc_redeem(body: dict = Body(...), user: str = Depends(_user)):
    from . import hubclient
    return _hc(hubclient.pull, user, "", None, "code", str(body.get("code") or ""))


@app.post("/api/uploads/{uid}/publish")
def hubc_publish(uid: str, body: dict = Body(default={}), user: str = Depends(_user)):
    from . import hubclient
    return _hc(hubclient.publish, user, uid, str(body.get("note") or ""), bool(body.get("take")))


@app.get("/api/uploads/{uid}/hub")
def hubc_project(uid: str, user: str = Depends(_user)):
    from . import hubclient, package
    name = storage.name_of(uid)
    if not name:
        raise HTTPException(404)
    out = {"published": storage.setting(name, "hub_published"), "pid": storage.setting(name, "pid"), "connected": hubclient.connected(user), "lock": None, "codes": []}
    if out["connected"] and out["published"]:
        try:
            out["lock"] = hubclient.call_json("GET", f"/hub/v1/projects/{out['published']['pid']}/lock", user, timeout=8)
            out["codes"] = hubclient.call_json("GET", f"/hub/v1/projects/{out['published']['pid']}/share-codes", user, timeout=8)
        except hubclient.HubClientError as e:
            out["error"] = e.message
    out["is_ref"] = package.is_ref(name)
    return out


@app.post("/api/uploads/{uid}/share-code")
def hubc_share_code(uid: str, body: dict = Body(default={}), user: str = Depends(_user)):
    from . import hubclient
    name = storage.name_of(uid)
    pub = storage.setting(name, "hub_published")
    if not pub:
        raise HTTPException(400, "먼저 PMS 대시보드에 게시하세요")
    return _hc(hubclient.call_json, "POST", "/hub/v1/share-codes", user,
               {"pid": pub["pid"], "version": body.get("version"), "days": body.get("days") or 7, "max_uses": body.get("max_uses"), "target": body.get("target")})



# ============================================================ PMS P3: 이슈 보드·AI 브리핑·포트폴리오 질의 (PMS 대시보드)
@app.get("/api/issues")
def issues_list(project: str | None = None, status: str | None = "open"):
    from . import issues
    return issues.listing(project, status or None)


@app.get("/api/issues/summary")
def issues_summary():
    from . import issues
    return issues.summary()


@app.get("/api/issues/{iid}")
def issue_get(iid: str):
    from . import issues
    x = issues.get(iid)
    if not x:
        raise HTTPException(404)
    return x


@app.post("/api/issues/{iid}")
def issue_update(iid: str, request: Request, body: dict = Body(...), user: str = Depends(_user)):
    from . import issues
    x = issues.get(iid)
    if not x:
        raise HTTPException(404)
    u = request.state.user
    if auth_mod.users_exist() and not (u.get("role") == "admin" or access.can_write(u, x["project"])):
        raise HTTPException(403, "프로젝트 소유자·멤버 또는 관리자만 이슈 상태를 바꿀 수 있습니다")
    try:
        return issues.update(iid, user, body.get("status"), body.get("assignee"), str(body.get("note") or ""))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/issues/{iid}/ai")
def issue_ai(iid: str, body: dict = Body(default={}), user: str = Depends(_user)):
    from . import issues
    try:
        return issues.explain(iid, user, bool(body.get("refresh")))
    except KeyError:
        raise HTTPException(404)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/admin/issues/evaluate")
def issues_evaluate_all():
    from . import issues
    out = {}
    for p in storage.latest_by_project():
        out[p["name"]] = issues.evaluate(p["id"])
    return out


@app.get("/api/dashboard/briefing")
def dash_briefing(refresh: int = 0, user: str = Depends(_user)):
    from . import issues
    return issues.briefing(user, bool(refresh))


@app.post("/api/dashboard/ask")
def dash_ask(body: dict = Body(...), user: str = Depends(_user)):
    from . import issues
    try:
        return issues.ask(str(body.get("q") or ""), user)
    except ValueError as e:
        raise HTTPException(400, str(e))



# ============================================================ PMS P4: 대시보드 ↔ 현장 협업 (코멘트·이슈는 대시보드가 기준)
def _hub_project_for(u: dict, pid: str) -> dict:
    from . import hub
    p = hub.project(pid)
    if not p or not hub._can_read(u, p):
        raise HTTPException(404, "볼 수 없는 프로젝트입니다")
    return p


@app.get("/hub/v1/projects/{pid}/feed")
def hub_feed(pid: str, request: Request):
    from . import issues
    u, _ = _hub_auth(request)
    p = _hub_project_for(u, pid)
    return {"project": p["name"], "comments": storage.rec_list("comment", p["name"])[-100:], "issues": issues.listing(p["name"], "open")}


@app.post("/hub/v1/projects/{pid}/comments")
def hub_comment(pid: str, request: Request, body: dict = Body(...)):
    from . import hub
    u, _ = _hub_auth(request)
    p = _hub_project_for(u, pid)
    text = str(body.get("text") or "").strip()[:2000]
    if not text:
        raise HTTPException(400, "내용을 입력하세요")
    ments = _mentions(text)
    last = hub.latest(pid)
    cid = storage.rec_put("comment", p["name"], {"target": str(body.get("target") or f"project:{p['name']}")[:80], "text": text, "mentions": ments,
                                                "resolved": False, "via": "현장"}, u["username"])
    notify.push(set(ments) | set(notify.project_people(p["name"])), "mention" if ments else "new_update",
                f"{u['username']} 님이 '{p['name']}'에 코멘트를 남겼습니다: {text[:80]}", f"#/p/{last['upload_id']}/overview?c={cid}" if last else "#/", exclude=u["username"])
    return {"id": cid}


@app.post("/hub/v1/projects/{pid}/records")
def hub_records(pid: str, request: Request, body: dict = Body(...)):
    """리스크·제약 양방향 동기화: 현장 것을 합치고(나중에 고친 쪽 우선) 합친 결과를 돌려준다."""
    from . import access, hub, recsync
    u, _ = _hub_auth(request)
    p = _hub_project_for(u, pid)
    if not access.can_write(u, p["name"]):
        raise HTTPException(403, "이 프로젝트의 리스크·제약을 고칠 권한이 없습니다")
    st = recsync.merge(p["name"], body, "현장", u["username"])
    if st["added"] or st["updated"] or st["deleted"]:
        last = hub.latest(pid)
        if last:
            try:
                from . import issues
                issues.evaluate(last["upload_id"])
            except Exception:  # noqa: BLE001 — 이슈 재계산 실패가 동기화를 막지 않게
                pass
    return {"stats": st, "records": recsync.export(p["name"])}


@app.get("/api/uploads/{uid}/sync-log")
def sync_log(uid: str, user: str = Depends(_user)):
    from . import recsync
    name = storage.name_of(uid)
    if not name:
        raise HTTPException(404, "없는 업데이트입니다")
    return recsync.log(name)


@app.post("/api/uploads/{uid}/sync-log/{lid}/restore")
def sync_log_restore(uid: str, lid: str, user: str = Depends(_user)):
    """동기화로 덮어쓴·지워진 리스크·제약을 되살린다(지금 시각으로 저장되므로 다음 동기화 때 상대편에도 퍼짐)."""
    name = storage.name_of(uid)
    x = storage.rec_get("sync_log", lid)
    if not name or not x or x["scope"] != name:
        raise HTTPException(404, "없는 기록입니다")
    storage.rec_put(x["kind"], name, x["lost"], user, rid=x["rid"])
    storage.rec_put("sync_log", name, {**{k: v for k, v in x.items() if k not in ("id", "scope", "updated_at")}, "restored_by": user}, user, rid=lid)
    return {"ok": True}


def _pid_of(uid: str) -> str | None:
    from . import package
    name = storage.name_of(uid)
    if not name:
        return None
    return (package.ref_meta(name) or {}).get("pid") or (storage.setting(name, "hub_published") or {}).get("pid")


@app.get("/api/uploads/{uid}/hub-feed")
def hubc_feed(uid: str, user: str = Depends(_user)):
    from . import hubclient
    pid = _pid_of(uid)
    if not pid or not hubclient.connected(user):
        return {"available": False}
    return {"available": True, **_hc(hubclient.call_json, "GET", f"/hub/v1/projects/{pid}/feed", user, timeout=10)}


@app.post("/api/uploads/{uid}/hub-comments")
def hubc_comment(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    from . import hubclient
    pid = _pid_of(uid)
    if not pid:
        raise HTTPException(400, "PMS 대시보드에 게시·구독된 프로젝트가 아닙니다")
    return _hc(hubclient.call_json, "POST", f"/hub/v1/projects/{pid}/comments", user, {"text": body.get("text"), "target": body.get("target")})


# ============================================================ PMS P5: 운영 — 상태 확인·백업
@app.get("/api/health")
def health_check():
    """감시용 상태 확인(로그인 필요). 판·DB 크기·프로젝트 수·마지막 게시."""
    from . import updater
    out = {"ok": True, "edition": edition.EDITION, "version": _version_label(), "projects": len(storage.latest_by_project()),
           "db_mb": round(os.path.getsize(storage.DB_PATH) / 1048576, 1) if os.path.exists(storage.DB_PATH) else 0}
    if edition.EDITION == "server":
        from . import hub, issues
        st = hub.publish_status()
        out.update({"hub_projects": len(st), "last_publish": max([x["published_at"] or "" for x in st] or [""]) or None,
                    "open_issues": issues.summary()["open"], "devices": sum(1 for d in hub.devices() if not d["revoked"])})
    out["last_update"] = (updater.last_update() or {}).get("at")
    return out


@app.get("/api/admin/backup")
def admin_backup(user: str = Depends(_user)):
    """관리자: 지금 데이터베이스를 백업 파일로 내려받기 (사용 중에도 안전한 온라인 백업)."""
    from . import updater
    path = updater.backup_db()
    if not path:
        raise HTTPException(404, "데이터베이스가 없습니다")
    storage.audit(user, "GET", "/api/admin/backup", 200, os.path.basename(path))
    data = open(path, "rb").read()
    return Response(data, media_type="application/octet-stream", headers={"Content-Disposition": f"attachment; filename={os.path.basename(path)}"})
