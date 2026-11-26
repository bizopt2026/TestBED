"""기능 서비스 계층: 엔진·규칙 분석·AI 를 묶어 API 에 제공.

① 자연어 질의(chat)  ② 월간 보고서(report)  ③ DCMA 가이드(dcma_guide)
④ 지연 원인(delay)   ⑤ What-if(whatif)    ⑥ 관계 추천(rel_suggest)
⑦ 공종 분류(classify) ⑧ 리스크(monte_carlo) ⑨ 지연 위험(risk)
⑩ 벤치마크(benchmark) ⑪ 작업일보 진도 추출(daily_extract)
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from functools import lru_cache

from . import ai, insights, storage
from .analysis import analyze
from .changes import apply_changes
from .schedule import Schedule
from .xer_parser import decode, detect_encoding, header_line, parse_tables, table_fields, write_xer

# ---------------------------------------------------------------- 공통 로딩


@lru_cache(maxsize=16)
def _tables(uid: str):
    r = storage.get_raw(uid)
    if not r:
        raise KeyError(uid)
    text = decode(r["raw"])
    return parse_tables(text), r["proj_id"], header_line(text), table_fields(text), detect_encoding(r["raw"]), r["filename"]


def tables(uid: str):
    t, pid, *_ = _tables(uid)
    return t, pid


def schedule(uid: str) -> Schedule:
    t, pid = tables(uid)
    return Schedule(t, pid)


def result(uid: str) -> dict:
    d = storage.get(uid)
    if not d:
        raise KeyError(uid)
    return d["result"]


def previous_upload(uid: str):
    r = result(uid)
    hist = [h for h in storage.history(r["name"]) if h["id"] != uid and h["data_date"] < r["data_date"]]
    return hist[-1] if hist else None


def act_brief(a: dict) -> dict:
    keys = ("code", "name", "wbs", "status", "orig_dur", "rem_dur", "pct", "start", "finish",
            "late_finish", "tf", "ff", "longest", "bl_start", "bl_finish", "constraint")
    return {k: a.get(k) for k in keys}


# ---------------------------------------------------------------- ⑦ 공종 분류


def trade_map(uid: str) -> dict[str, str]:
    m = storage.get_extra(uid, "trades")
    if m:
        return m["map"]
    r = result(uid)
    return {a["code"]: insights.classify_rule(a["name"], a["wbs"]) for a in r["activities"]}


def classify(uid: str, use_ai: bool = True, user: str = "") -> dict:
    r = result(uid)
    rule = {a["code"]: insights.classify_rule(a["name"], a["wbs"]) for a in r["activities"]}
    method = "규칙"
    if use_ai and ai.available():
        items = [{"code": a["code"], "name": a["name"], "wbs": a["wbs"]} for a in r["activities"] if not a["milestone"]]
        schema = {"type": "object", "additionalProperties": False, "required": ["items"],
                  "properties": {"items": {"type": "array", "items": {
                      "type": "object", "additionalProperties": False, "required": ["code", "trade", "std_name"],
                      "properties": {"code": {"type": "string"}, "trade": {"type": "string", "enum": insights.TRADES},
                                     "std_name": {"type": "string"}}}}}}
        system = ("당신은 건설 공정관리 전문가입니다. 액티비티를 표준 공종으로 분류하고, "
                  "업체마다 다른 액티비티명을 '공종-부위-작업' 형식의 짧은 표준 명칭으로 정리합니다. "
                  "모르는 것은 '기타'로 둡니다.")
        std = {}
        for i in range(0, len(items), 300):
            chunk = items[i:i + 300]
            out, usage = ai.structured(system, "다음 액티비티를 분류하세요:\n" + "\n".join(
                f"{x['code']}\t{x['name']}\t{x['wbs']}" for x in chunk), schema, effort="low")
            storage.log_ai(uid, "classify", user, usage, 0, True)
            codes = {x["code"] for x in chunk}
            for x in out["items"]:
                if x["code"] in codes:
                    rule[x["code"]] = x["trade"]
                    std[x["code"]] = x["std_name"]
        method = "AI"
        storage.set_extra(uid, "std_names", std)
    storage.set_extra(uid, "trades", {"map": rule, "method": method})
    return trade_summary(uid)


def trade_summary(uid: str) -> dict:
    r = result(uid)
    m = trade_map(uid)
    meta = storage.get_extra(uid, "trades")
    std = storage.get_extra(uid, "std_names") or {}
    agg = {}
    for a in r["activities"]:
        t = m.get(a["code"], "기타")
        g = agg.setdefault(t, {"trade": t, "count": 0, "critical": 0, "rem_days": 0, "done": 0})
        g["count"] += 1
        g["critical"] += 1 if a["longest"] else 0
        g["rem_days"] += a["rem_dur"]
        g["done"] += 1 if a["status_code"] == "TK_Complete" else 0
    return {"method": meta["method"] if meta else "규칙(자동)", "map": m, "std_names": std,
            "summary": sorted(agg.values(), key=lambda x: -x["count"])}


# ---------------------------------------------------------------- ③ DCMA 가이드


def dcma_guide(uid: str, use_ai: bool = False, user: str = "") -> dict:
    s = schedule(uid)
    r = result(uid)
    guides = insights.dcma_guides(s, r["dcma"])
    out = {"guides": {str(k): v for k, v in guides.items()}, "narrative": None}
    if use_ai and ai.available():
        cached = storage.get_extra(uid, "dcma_narrative")
        if cached:
            out["narrative"] = cached
            return out
        fails = [d for d in r["dcma"] if not d["pass"] and d["threshold"] != "참고"]
        prompt = ("공정표 DCMA 14-Point 점검 결과와 규칙 기반 조치 가이드입니다. 공정관리 담당자가 바로 실행할 수 있도록 "
                  "우선순위 순서로 '무엇을, 왜, 어떻게' 고칠지 정리하세요. 숫자와 액티비티 ID는 제공된 것만 쓰세요. "
                  "마크다운 제목 없이 번호 목록 5~8개로 작성하세요.\n\n"
                  f"미달 항목: {[{k: d[k] for k in ('no', 'name', 'value', 'unit', 'threshold', 'count', 'total')} for d in fails]}\n"
                  f"항목별 예시 액티비티: { {d['no']: d['items'][:15] for d in fails} }\n"
                  f"규칙 기반 가이드: {guides}")
        text, usage = ai.complete(SYSTEM_BASE, prompt, effort="medium")
        storage.log_ai(uid, "dcma_guide", user, usage, 0, True)
        storage.set_extra(uid, "dcma_narrative", text)
        out["narrative"] = text
    return out


# ---------------------------------------------------------------- ④ 지연 원인


def delay(uid: str, base_uid: str | None = None) -> dict:
    target = result(uid)
    if base_uid:
        base = result(base_uid)
        bid = base_uid
    else:
        prev = previous_upload(uid)
        if not prev:
            return {"available": False, "message": "같은 프로젝트의 이전 업데이트가 없어 비교할 수 없습니다."}
        base, bid = prev["result"], prev["id"]
    out = insights.delay_attribution(base, target)
    out.update({"available": True, "base_id": bid, "base_data_date": base["data_date"], "base_finish": base["finish"],
                "target_data_date": target["data_date"], "target_finish": target["finish"]})
    return out


# ---------------------------------------------------------------- ⑤ What-if


def whatif(uid: str, changes: list[dict]) -> dict:
    t, pid = tables(uid)
    new_t, log = apply_changes(t, pid, changes)
    s2 = Schedule(new_t, pid)
    after = analyze(s2)
    before = result(uid)
    mb = {a["code"]: a for a in before["activities"]}
    moved = []
    for a in after["activities"]:
        b = mb.get(a["code"])
        if not b:
            continue
        df = (date.fromisoformat(a["finish"]) - date.fromisoformat(b["finish"])).days
        if df or (a["tf"] != b["tf"]):
            moved.append({"code": a["code"], "name": a["name"], "finish_before": b["finish"], "finish_after": a["finish"],
                          "d_finish": df, "tf_before": b["tf"], "tf_after": a["tf"], "longest": a["longest"]})
    moved.sort(key=lambda x: (-abs(x["d_finish"]), x["code"]))
    return {"log": log, "finish_before": before["finish"], "finish_after": after["finish"],
            "d_finish": (date.fromisoformat(after["finish"]) - date.fromisoformat(before["finish"])).days,
            "longest_before": [a["code"] for a in before["activities"] if a["longest"]],
            "longest_after": [a["code"] for a in after["activities"] if a["longest"]],
            "dcma_pass_before": sum(d["pass"] for d in before["dcma"]),
            "dcma_pass_after": sum(d["pass"] for d in after["dcma"]),
            "changed": moved[:200]}


def export_xer(uid: str, changes: list[dict]) -> tuple[bytes, str]:
    t, pid, header, fields, enc, fname = _tables(uid)
    new_t, _ = apply_changes(t, pid, changes)
    text = write_xer(new_t, header, fields)
    base = re.sub(r"\.xer$", "", fname or "project", flags=re.I)
    try:
        return text.encode(enc if enc != "utf-8-sig" else "utf-8"), f"{base}_수정.xer"
    except UnicodeEncodeError:
        return text.encode("utf-8"), f"{base}_수정.xer"


# ---------------------------------------------------------------- ⑥ 관계 추천


def rel_suggest(uid: str, use_ai: bool = False, user: str = "") -> dict:
    s = schedule(uid)
    sugg = insights.suggest_relationships(s, 3)
    method = "규칙"
    if use_ai and ai.available() and sugg:
        r = result(uid)
        open_codes = sorted({x["target"] for x in sugg})
        by = {a["code"]: a for a in r["activities"]}
        ctx = []
        for c in open_codes[:60]:
            a = by[c]
            near = [x for x in r["activities"] if x["status_code"] != "TK_Complete" and x["code"] != c
                    and abs((date.fromisoformat(x["start"]) - date.fromisoformat(a["start"])).days) <= 90][:40]
            ctx.append({"target": act_brief(a), "has_pred": bool(a["preds"]), "has_succ": bool(a["succs"]),
                        "candidates": [{"code": x["code"], "name": x["name"], "wbs": x["wbs"], "start": x["start"],
                                        "finish": x["finish"]} for x in near]})
        schema = {"type": "object", "additionalProperties": False, "required": ["items"],
                  "properties": {"items": {"type": "array", "items": {
                      "type": "object", "additionalProperties": False,
                      "required": ["pred", "succ", "type", "lag", "confidence", "reason"],
                      "properties": {"pred": {"type": "string"}, "succ": {"type": "string"},
                                     "type": {"type": "string", "enum": ["FS", "SS", "FF", "SF"]},
                                     "lag": {"type": "integer"}, "confidence": {"type": "integer"},
                                     "reason": {"type": "string"}}}}}}
        out, usage = ai.structured(
            SYSTEM_BASE + " 시공 순서 상식에 맞는 선후행 관계만 추천합니다.",
            "선행 또는 후행 관계가 빠진 액티비티(target)마다, 후보(candidates) 중에서 연결할 관계를 0~2개 추천하세요. "
            "target에 후행이 없으면 target을 pred로, 선행이 없으면 target을 succ로 하세요. confidence는 0~100.\n"
            f"{ctx}", schema, effort="medium", model=ai.MODEL)
        storage.log_ai(uid, "rel_suggest", user, usage, 0, True)
        valid = {a["code"] for a in r["activities"]}
        sugg = []
        for x in out["items"]:
            if x["pred"] in valid and x["succ"] in valid and x["pred"] != x["succ"]:
                target = x["pred"] if x["pred"] in open_codes and not by[x["pred"]]["succs"] else x["succ"]
                sugg.append({"target": target, "target_name": by[target]["name"],
                             "missing": "후행" if target == x["pred"] else "선행",
                             "pred": x["pred"], "pred_name": by[x["pred"]]["name"], "succ": x["succ"],
                             "succ_name": by[x["succ"]]["name"], "type": x["type"], "lag": x["lag"],
                             "score": x["confidence"], "reasons": [x["reason"]]})
        method = "AI"
    return {"method": method, "items": sugg}


# ---------------------------------------------------------------- ⑧⑨⑩ 리스크·벤치마크


def _ratios():
    hist = storage.all_results()
    tmaps = {k: v["map"] for k, v in storage.all_extras("trades").items()}
    return insights.actual_ratios(hist, tmaps)


def monte_carlo(uid: str, iterations: int = 300, use_benchmark: bool = True) -> dict:
    s = schedule(uid)
    ranges = {}
    if use_benchmark:
        for t, r in _ratios().items():
            if r["n"] >= 5:
                ranges[t] = (min(0.9, r["median"] * 0.85), r["median"], max(r["p80"] * 1.1, r["median"] * 1.2))
    out = insights.monte_carlo(s, min(max(iterations, 50), 2000), ranges, trade_map(uid))
    if ranges:
        out["assumption"] += f" (벤치마크 보정 공종: {', '.join(ranges)})"
    return out


def risk(uid: str, limit: int = 50) -> dict:
    r = result(uid)
    hist = storage.history(r["name"])
    rows = insights.risk_scores(r, hist, trade_map(uid), _ratios())
    return {"history_updates": len(hist), "items": rows[:limit],
            "note": "점수는 여유일, 최장경로, 계획 대비 지연, 진도 부진, 공종 실적, 업데이트 간 순연 추세를 합산한 설명 가능한 지표입니다."
                    + ("" if len(hist) >= 3 else " 같은 프로젝트의 업데이트가 3회 이상 쌓이면 추세 요인이 반영됩니다.")}


def bench(uid: str) -> dict:
    ratios = _ratios()
    out = insights.benchmark(result(uid), trade_map(uid), ratios)
    out["ratios"] = ratios
    out["sample_projects"] = len({h["result"]["name"] for h in storage.all_results()})
    return out


# ---------------------------------------------------------------- ⑪ 작업일보 → 진도 입력안

DATE_RE = re.compile(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})")


def daily_extract(uid: str, text: str, report_date: str | None, user: str = "") -> dict:
    r = result(uid)
    by = {a["code"]: a for a in r["activities"]}
    rd = report_date or r["data_date"]
    method = "규칙"
    items = []
    if ai.available():
        open_acts = [f"{a['code']}\t{a['name']}\t{a['status']}\t{a['pct']}%" for a in r["activities"]
                     if a["status_code"] != "TK_Complete"]
        schema = {"type": "object", "additionalProperties": False, "required": ["items"],
                  "properties": {"items": {"type": "array", "items": {
                      "type": "object", "additionalProperties": False,
                      "required": ["code", "event", "date", "pct", "evidence", "confidence"],
                      "properties": {"code": {"type": "string"},
                                     "event": {"type": "string", "enum": ["착수", "진행", "완료"]},
                                     "date": {"type": ["string", "null"]}, "pct": {"type": ["number", "null"]},
                                     "evidence": {"type": "string"}, "confidence": {"type": "integer"}}}}}}
        out, usage = ai.structured(
            SYSTEM_BASE + " 작업일보 문장에서 공정 진도 사실만 추출합니다. 추측하지 말고, 문장에 근거가 있는 것만 뽑습니다.",
            f"작업일보 날짜: {rd}\n\n[작업일보]\n{text}\n\n[미완료 액티비티 목록: ID, 이름, 상태, 공정률]\n"
            + "\n".join(open_acts)
            + "\n\n작업일보에 언급된 작업을 목록의 액티비티 ID에 매칭하고 착수/진행/완료 여부, 날짜(YYYY-MM-DD, 없으면 작업일보 날짜), "
              "공정률(언급 시)을 추출하세요. evidence에는 근거 문장을 그대로 넣으세요. confidence 0~100.",
            schema, effort="medium")
        storage.log_ai(uid, "daily_extract", user, usage, 0, True)
        items = [x for x in out["items"] if x["code"] in by]
        method = "AI"
    else:
        for line in re.split(r"[\n.]", text):
            line = line.strip()
            if not line:
                continue
            for a in r["activities"]:
                if a["status_code"] == "TK_Complete":
                    continue
                if a["code"] in line or (len(a["name"]) >= 3 and a["name"] in line):
                    ev = "완료" if re.search(r"완료|끝|마감했", line) else "착수" if re.search(r"착수|시작|개시", line) else "진행"
                    m = re.search(r"(\d{1,3})\s*%", line)
                    dm = DATE_RE.search(line)
                    items.append({"code": a["code"], "event": ev, "date": f"{int(dm[1]):04d}-{int(dm[2]):02d}-{int(dm[3]):02d}" if dm else rd,
                                  "pct": float(m[1]) if m else None, "evidence": line, "confidence": 60})
    changes = []
    for x in items:
        a = by[x["code"]]
        ch = {"op": "set_progress", "code": x["code"]}
        d = x.get("date") or rd
        if x["event"] == "완료":
            ch["act_end"] = d
            if a["status_code"] == "TK_NotStart":
                ch["act_start"] = d
        elif x["event"] == "착수" and a["status_code"] == "TK_NotStart":
            ch["act_start"] = d
            if x.get("pct") is not None:
                ch["pct"] = x["pct"]
        else:
            if a["status_code"] == "TK_NotStart":
                ch["act_start"] = d
            if x.get("pct") is not None:
                ch["pct"] = x["pct"]
        x["name"] = a["name"]
        x["current"] = f"{a['status']} {a['pct']}%"
        changes.append(ch)
    return {"method": method, "items": items, "changes": changes}


# ---------------------------------------------------------------- ② 월간 공정보고

SYSTEM_BASE = ("당신은 건설·플랜트 프로젝트의 공정관리(Primavera P6) 전문가입니다. 한국어로 간결하게 답합니다. "
               "날짜·일수·공정률 등 모든 숫자는 제공된 데이터나 도구 결과에 있는 값만 사용하고, 추정할 때는 추정이라고 밝힙니다. "
               "액티비티를 언급할 때는 반드시 Activity ID를 함께 씁니다.")


def report_data(uid: str, base_uid: str | None = None) -> dict:
    r = result(uid)
    d = delay(uid, base_uid)
    rk = risk(uid, 10)
    la = insights.lookahead(r, 30)
    ms = [a for a in r["activities"] if a["milestone"]]
    return {
        "project": r["name"], "data_date": r["data_date"], "finish": r["finish"], "must_finish": r["must_finish"],
        "summary": r["summary"],
        "milestones": [act_brief(a) for a in sorted(ms, key=lambda a: a["finish"])],
        "delay": d,
        "dcma": [{k: x[k] for k in ("no", "name", "value", "unit", "threshold", "pass")} for x in r["dcma"]],
        "lookahead": [act_brief(a) for a in la[:40]],
        "lookahead_count": len(la),
        "risks": rk["items"],
        "longest_path": [act_brief(a) for a in r["activities"] if a["longest"]][:40],
    }


def report(uid: str, base_uid: str | None = None, use_ai: bool = True, user: str = "") -> dict:
    data = report_data(uid, base_uid)
    sections = None
    if use_ai and ai.available():
        schema = {"type": "object", "additionalProperties": False,
                  "required": ["headline", "summary", "progress", "delay_causes", "critical_path", "next_month",
                               "risks_actions", "requests"],
                  "properties": {k: {"type": "string"} for k in
                                 ("headline", "summary", "progress", "delay_causes", "critical_path", "next_month",
                                  "risks_actions", "requests")}}
        out, usage = ai.structured(
            SYSTEM_BASE + " 발주처와 경영진에게 보고하는 월간 공정보고서를 작성합니다. 개조식(~함, ~임)으로 씁니다.",
            "아래 데이터로 월간 공정보고서 각 항목을 작성하세요. headline은 한 문장 핵심 메시지, summary는 3~4줄, "
            "나머지 항목은 줄바꿈으로 구분한 3~6개 항목(각 줄 앞에 '- ')으로 작성하세요. delay_causes는 지연 기여도 데이터를 "
            "근거로, requests는 의사결정·지원 요청 사항을 쓰세요.\n\n" + str(data),
            schema, effort="high", model=ai.MODEL)
        storage.log_ai(uid, "report", user, usage, 0, True)
        sections = out
    if sections is None:
        sections = template_report(data)
    return {"data": data, "sections": sections, "method": "AI" if use_ai and ai.available() else "템플릿"}


def template_report(d: dict) -> dict:
    s = d["summary"]
    dl = d["delay"]
    slip = dl.get("finish_slip") if dl.get("available") else None
    must = d["must_finish"]
    margin = (date.fromisoformat(must) - date.fromisoformat(d["finish"])).days if must else None
    head = f"예상 준공일 {d['finish']}"
    if slip is not None:
        head += f"(전월 대비 {'+' if slip > 0 else ''}{slip}일)"
    if margin is not None:
        head += f", 목표 대비 {'여유 ' + str(margin) if margin >= 0 else '지연 ' + str(-margin)}일"
    lines = lambda xs: "\n".join(f"- {x}" for x in xs) if xs else "- 해당 없음"
    causes = [f"{x['code']} {x['name']}: 준공 영향 +{x['introduced']}일{(' (' + x['note'] + ')') if x['note'] else ''}"
              for x in (dl.get("top") or []) if x["introduced"] > 0][:5]
    return {
        "headline": head,
        "summary": f"Data Date {d['data_date']} 기준 공정률 {s['progress_pct']}%, 액티비티 {s['activities']}개 중 완료 "
                   f"{s['completed']}개·진행 {s['in_progress']}개. 잔여 작업일 {s['remaining_workdays']}일.",
        "progress": lines([f"완료 {s['completed']} / 진행 {s['in_progress']} / 미착수 {s['not_started']}",
                           f"DCMA 통과 {sum(x['pass'] for x in d['dcma'])}/14"]),
        "delay_causes": lines(causes) if dl.get("available") else "- 이전 업데이트가 없어 비교 불가",
        "critical_path": lines([f"{a['code']} {a['name']} ({a['start']}~{a['finish']})" for a in d["longest_path"][:6]]),
        "next_month": lines([f"{a['code']} {a['name']} " + (f"완료 예정 {a['finish']}" if a["status"] == "진행중"
                                                             else f"착수 {a['start']}") for a in d["lookahead"][:8]]),
        "risks_actions": lines([f"{x['code']} {x['name']} (위험 {x['score']}: {', '.join(x['reasons'][:3])})"
                                for x in d["risks"][:5]]),
        "requests": "- (작성 필요)",
    }


def report_docx(rep: dict) -> bytes:
    import io

    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.shared import Pt, RGBColor

    d, sec = rep["data"], rep["sections"]
    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = "맑은 고딕"
    st.element.rPr.rFonts.set(qn("w:eastAsia"), "맑은 고딕")
    st.font.size = Pt(10)

    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = t.add_run(f"{d['project']} 월간 공정보고")
    run.bold = True
    run.font.size = Pt(16)
    p = doc.add_paragraph(f"Data Date {d['data_date']}  |  작성 {date.today().isoformat()}")
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    box = doc.add_table(rows=1, cols=1)
    box.style = "Table Grid"
    cell = box.rows[0].cells[0]
    shd = cell._tc.get_or_add_tcPr()
    from docx.oxml import OxmlElement
    sh = OxmlElement("w:shd")
    sh.set(qn("w:fill"), "EDEDED")
    shd.append(sh)
    cp = cell.paragraphs[0]
    r1 = cp.add_run(sec["headline"])
    r1.bold = True
    cell.add_paragraph(sec["summary"])

    def heading(txt):
        h = doc.add_paragraph()
        rr = h.add_run("□ " + txt)
        rr.bold = True
        rr.font.size = Pt(12)

    def body(txt):
        for line in (txt or "").splitlines():
            line = line.strip()
            if line:
                doc.add_paragraph(("○ " + line[2:]) if line.startswith("- ") else line)

    heading("공정 현황")
    s = d["summary"]
    tb = doc.add_table(rows=2, cols=5)
    tb.style = "Table Grid"
    for i, (k, v) in enumerate([("예상 준공", d["finish"]), ("목표 준공", d["must_finish"] or "-"),
                                ("공정률", f"{s['progress_pct']}%"), ("잔여 작업일", f"{s['remaining_workdays']}일"),
                                ("DCMA 통과", f"{sum(x['pass'] for x in d['dcma'])}/14")]):
        tb.cell(0, i).text, tb.cell(1, i).text = k, str(v)
    body(sec["progress"])
    heading("지연 원인")
    body(sec["delay_causes"])
    heading("주공정")
    body(sec["critical_path"])
    heading("향후 1개월 주요 작업")
    body(sec["next_month"])
    heading("리스크 및 대책")
    body(sec["risks_actions"])
    heading("요청 사항")
    body(sec["requests"])
    ms = d["milestones"]
    if ms:
        heading("마일스톤")
        tb = doc.add_table(rows=1 + len(ms), cols=4)
        tb.style = "Table Grid"
        for i, h in enumerate(["ID", "마일스톤", "예정일", "계획일"]):
            tb.cell(0, i).text = h
        for j, a in enumerate(ms, start=1):
            tb.cell(j, 0).text, tb.cell(j, 1).text = a["code"], a["name"]
            tb.cell(j, 2).text, tb.cell(j, 3).text = a["finish"] or "", a["bl_finish"] or "-"
    foot = doc.add_paragraph(f"※ 본 보고서는 공정관리 분석기에서 {'AI가 초안을 작성' if rep['method'] == 'AI' else '템플릿으로 생성'}했으며, "
                             "수치는 CPM 엔진 계산 결과입니다. 제출 전 담당자 검토가 필요합니다.")
    foot.runs[0].font.size = Pt(8)
    foot.runs[0].font.color.rgb = RGBColor(0x6B, 0x72, 0x80)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------- ① 자연어 질의 (도구 사용)

CHAT_TOOLS = [
    {"name": "project_summary", "description": "프로젝트 요약(Data Date, 예상/목표 준공일, 공정률, 상태별 개수, 주공정 수, DCMA 통과 수).",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "search_activities",
     "description": "조건으로 액티비티를 검색한다. 날짜는 YYYY-MM-DD. 결과는 최대 limit개, 시작일 순.",
     "input_schema": {"type": "object", "additionalProperties": False, "properties": {
         "text": {"type": "string", "description": "ID·이름·WBS 부분 일치 (공백으로 여러 단어 AND)"},
         "status": {"type": "string", "enum": ["미착수", "진행중", "완료", "미완료"]},
         "longest_path_only": {"type": "boolean"},
         "max_total_float": {"type": "integer"}, "min_total_float": {"type": "integer"},
         "start_from": {"type": "string"}, "start_to": {"type": "string"},
         "finish_from": {"type": "string"}, "finish_to": {"type": "string"},
         "trade": {"type": "string", "enum": insights.TRADES},
         "late_vs_plan": {"type": "boolean", "description": "계획(Target) 종료일보다 늦은 작업만"},
         "limit": {"type": "integer"}}}},
    {"name": "get_activity", "description": "액티비티 상세와 선행/후행 관계.",
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["code"],
                      "properties": {"code": {"type": "string"}}}},
    {"name": "longest_path", "description": "Data Date부터 준공까지의 최장 경로(주공정) 액티비티 목록.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "dcma_check", "description": "DCMA 14-Point 점검 결과와 조치 가이드.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "delay_analysis", "description": "직전 업데이트 대비 준공 지연일과 액티비티별 지연 기여도.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "what_if",
     "description": "변경안을 적용해 공정을 재계산하고 준공일·주공정 변화를 반환한다(원본은 바뀌지 않음). "
                    "op: set_duration{code,days}, add_rel{pred,succ,type,lag}, remove_rel{pred,succ}, set_lag{pred,succ,lag}, "
                    "set_progress{code,act_start,act_end,pct,remaining_days}.",
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["changes"], "properties": {
         "changes": {"type": "array", "items": {"type": "object", "properties": {
             "op": {"type": "string", "enum": ["set_duration", "add_rel", "remove_rel", "set_lag", "set_progress"]},
             "code": {"type": "string"}, "days": {"type": "number"}, "pred": {"type": "string"},
             "succ": {"type": "string"}, "type": {"type": "string"}, "lag": {"type": "number"},
             "act_start": {"type": "string"}, "act_end": {"type": "string"}, "pct": {"type": "number"},
             "remaining_days": {"type": "number"}}, "required": ["op"]}}}}},
    {"name": "delay_risk", "description": "지연 위험 점수 상위 액티비티와 사유.",
     "input_schema": {"type": "object", "additionalProperties": False, "properties": {"limit": {"type": "integer"}}}},
    {"name": "schedule_risk_simulation", "description": "몬테카를로 시뮬레이션으로 P50/P80/P90 준공일과 목표 달성 확률.",
     "input_schema": {"type": "object", "additionalProperties": False, "properties": {"iterations": {"type": "integer"}}}},
]


def _search(r: dict, tmap: dict, q: dict) -> dict:
    acts = r["activities"]
    words = (q.get("text") or "").lower().split()
    st = q.get("status")
    res = []
    for a in acts:
        hay = f"{a['code']} {a['name']} {a['wbs']}".lower()
        if words and not all(w in hay for w in words):
            continue
        if st == "미완료" and a["status_code"] == "TK_Complete":
            continue
        if st and st != "미완료" and a["status"] != st:
            continue
        if q.get("longest_path_only") and not a["longest"]:
            continue
        if q.get("max_total_float") is not None and (a["tf"] is None or a["tf"] > q["max_total_float"]):
            continue
        if q.get("min_total_float") is not None and (a["tf"] is None or a["tf"] < q["min_total_float"]):
            continue
        if q.get("start_from") and a["start"] < q["start_from"]:
            continue
        if q.get("start_to") and a["start"] > q["start_to"]:
            continue
        if q.get("finish_from") and a["finish"] < q["finish_from"]:
            continue
        if q.get("finish_to") and a["finish"] > q["finish_to"]:
            continue
        if q.get("trade") and tmap.get(a["code"]) != q["trade"]:
            continue
        if q.get("late_vs_plan") and not (a["bl_finish"] and a["finish"] > a["bl_finish"]):
            continue
        res.append(a)
    res.sort(key=lambda a: (a["start"], a["code"]))
    lim = min(int(q.get("limit") or 50), 200)
    return {"total": len(res), "returned": min(lim, len(res)),
            "items": [dict(act_brief(a), trade=tmap.get(a["code"])) for a in res[:lim]]}


def chat(uid: str, messages: list[dict], user: str = "") -> dict:
    r = result(uid)
    tmap = trade_map(uid)
    by = {a["code"]: a for a in r["activities"]}
    by_id = {a["id"]: a for a in r["activities"]}

    def execute(name: str, inp: dict):
        if name == "project_summary":
            return {"project": r["name"], "data_date": r["data_date"], "finish": r["finish"],
                    "must_finish": r["must_finish"], **r["summary"],
                    "dcma_pass": sum(d["pass"] for d in r["dcma"])}
        if name == "search_activities":
            return _search(r, tmap, inp)
        if name == "get_activity":
            a = by.get(inp["code"])
            if not a:
                raise ValueError(f"액티비티 {inp['code']} 없음")
            rel = lambda xs: [{"code": by_id[x["id"]]["code"], "name": by_id[x["id"]]["name"], "type": x["type"],
                               "lag": x["lag"], "finish": by_id[x["id"]]["finish"], "tf": by_id[x["id"]]["tf"]} for x in xs]
            return dict(act_brief(a), calendar=a["calendar"], trade=tmap.get(a["code"]),
                        predecessors=rel(a["preds"]), successors=rel(a["succs"]))
        if name == "longest_path":
            return [act_brief(a) for a in r["activities"] if a["longest"]]
        if name == "dcma_check":
            g = dcma_guide(uid)["guides"]
            return [{**{k: d[k] for k in ("no", "name", "value", "unit", "threshold", "pass")},
                     "examples": d["items"][:10], "guide": g.get(str(d["no"]), [])} for d in r["dcma"]]
        if name == "delay_analysis":
            d = delay(uid)
            if d.get("available"):
                d["path"] = d["path"][:40]
            return d
        if name == "what_if":
            return whatif(uid, inp["changes"])
        if name == "delay_risk":
            return risk(uid, int(inp.get("limit") or 15))
        if name == "schedule_risk_simulation":
            m = monte_carlo(uid, int(inp.get("iterations") or 300))
            m["histogram"] = m["histogram"][:40]
            return m
        raise ValueError(f"알 수 없는 도구 {name}")

    today = date.today().isoformat()
    system = (SYSTEM_BASE + f"\n지금 보고 있는 프로젝트: {r['name']} (Data Date {r['data_date']}, 오늘 {today}). "
              "질문에 답하려면 반드시 도구로 데이터를 조회하세요. 목록은 마크다운 표로 보여 주고, 표에는 ID를 첫 열로 넣으세요. "
              "What-if 결과는 '가정에 따른 계산'임을 밝히세요. 데이터로 답할 수 없는 질문은 그렇다고 말하세요.")
    msgs = [{"role": m["role"], "content": str(m["content"])[:8000]} for m in messages[-12:]
            if m.get("role") in ("user", "assistant") and m.get("content")]
    if not msgs or msgs[0]["role"] != "user":
        raise ValueError("대화는 사용자 메시지로 시작해야 합니다")
    out = ai.run_agent(system, msgs, CHAT_TOOLS, execute, effort="medium")
    storage.log_ai(uid, "chat", user, out["usage"], out["seconds"], True)
    codes = [c for c in dict.fromkeys(re.findall(r"[A-Za-z0-9][\w.\-]*", out["answer"])) if c in by]
    out["codes"] = codes[:300]
    return out
