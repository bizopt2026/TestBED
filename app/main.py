"""웹 서버 (FastAPI)."""
from __future__ import annotations

import csv
import io
import os
from datetime import date

from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from urllib.parse import unquote

from . import ai, services, storage
from .analysis import analyze
from .changes import ChangeError
from .schedule import Schedule, list_projects
from .xer_parser import parse_xer

STATIC = os.path.join(os.path.dirname(__file__), "..", "static")
MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "100")) * 1024 * 1024
APP_TOKEN = os.environ.get("APP_TOKEN", "")

app = FastAPI(title="공정관리 XER 분석기")
storage.init()


def auth(x_app_token: str = Header(default="")):
    if APP_TOKEN and x_app_token != APP_TOKEN:
        raise HTTPException(401, "접근 토큰이 올바르지 않습니다")


@app.get("/api/config")
def config():
    return {"token_required": bool(APP_TOKEN)}


@app.post("/api/upload", dependencies=[Depends(auth)])
async def upload(file: UploadFile = File(...), uploader: str = Form(""), note: str = Form("")):
    raw = await file.read()
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "파일이 너무 큽니다")
    try:
        tables = parse_xer(raw)
        projects = list_projects(tables)
        if not projects:
            raise ValueError("PROJECT 테이블이 없습니다")
        ids = []
        for p in projects:
            try:
                s = Schedule(tables, p["proj_id"])
            except ValueError:
                continue
            result = analyze(s)
            ids.append(storage.save(file.filename, p["proj_id"], result["name"],
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
    result = analyze(Schedule(parse_xer(r["raw"]), r["proj_id"]))
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


try:
    import anthropic

    @app.exception_handler(anthropic.APIError)
    async def _api_err(_: Request, e: Exception):
        msg = getattr(e, "message", str(e))
        code = 429 if isinstance(e, anthropic.RateLimitError) else 502
        return JSONResponse({"detail": f"AI 서비스 오류: {msg}"}, status_code=code)
except ImportError:  # pragma: no cover
    pass


def _user(x_user: str = Header(default="")) -> str:
    return unquote(x_user)[:50]


@app.get("/api/ai/status", dependencies=[Depends(auth)])
def ai_status():
    return {**ai.status(), "usage": storage.ai_usage()}


@app.post("/api/uploads/{uid}/chat", dependencies=[Depends(auth)])
def chat(uid: str, body: dict = Body(...), user: str = Depends(_user)):
    try:
        return services.chat(uid, body.get("messages") or [], user)
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


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"))


app.mount("/static", StaticFiles(directory=STATIC), name="static")
