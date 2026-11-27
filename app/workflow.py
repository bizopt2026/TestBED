"""상황판(개요), 데이터 준비도, 월간 업데이트 점검(마법사) 집계."""
from __future__ import annotations

from datetime import date, timedelta

from . import services, storage
from .evm import baseline_variance


def _dd(a, b):
    return (date.fromisoformat(a) - date.fromisoformat(b)).days if a and b else None


def base_result(uid: str, base_uid: str | None):
    if base_uid:
        try:
            return base_uid, services.result(base_uid)
        except KeyError:
            pass
    p = services.previous_upload(uid)
    return (p["id"], p["result"]) if p else (None, None)


# ---------------------------------------------------------------- ⑤ 데이터 준비도
def readiness(uid: str) -> list[dict]:
    r = services.result(uid)
    t, _ = services.tables(uid)
    acts = r["activities"]
    n = max(len(acts), 1)
    bl = sum(1 for a in acts if a["bl_finish"]) / n
    cost = any(float(x.get("target_cost") or 0) > 0 for x in t.get("TASKRSRC", []))
    hist = [h for h in storage.history(r["name"]) if h["data_date"] <= r["data_date"]]   # 이 업데이트 시점까지
    trades = storage.get_extra(uid, "trades")
    rows = [
        {"key": "baseline", "label": "베이스라인(계획 날짜)", "ok": bl >= 0.8, "detail": f"{bl * 100:.0f}% 작업에 계획 날짜",
         "unlocks": "계획 대비 지연, BEI, Missed Tasks, 베이스라인 편차",
         "fix": "P6에서 Target(계획) 날짜를 채우거나, 같은 프로젝트의 승인 업데이트를 '베이스라인·EVM'에서 베이스라인으로 지정하세요.", "tab": "evm"},
        {"key": "cost", "label": "자원·비용", "ok": cost, "detail": "비용 있음" if cost else "TASKRSRC 비용 없음",
         "unlocks": "EVM(SPI·CPI·EAC), 비용 S-Curve", "fix": "P6에서 자원·비용이 배정된 상태로 XER을 내보내세요(MS Project는 자원 비용).", "tab": "evm"},
        {"key": "history", "label": "업데이트 이력(2회 이상)", "ok": len(hist) >= 2, "detail": f"{len(hist)}회",
         "unlocks": "지연 원인, 변경 로그, 공기 압축 탐지, 추세", "fix": "매월 같은 프로젝트 이름으로 업데이트 XER을 올리세요.", "tab": "analysis"},
        {"key": "must_finish", "label": "목표 준공일(Must Finish By)", "ok": bool(r["must_finish"]), "detail": r["must_finish"] or "없음",
         "unlocks": "목표 대비 여유, 음수 여유, CPLI, 목표 달성 확률", "fix": "P6 프로젝트 설정의 Must Finish By 날짜를 입력해 다시 내보내세요.", "tab": "overview"},
        {"key": "progress", "label": "진도(실적) 반영", "ok": r["summary"]["completed"] + r["summary"]["in_progress"] > 0,
         "detail": f"완료 {r['summary']['completed']} · 진행 {r['summary']['in_progress']}",
         "unlocks": "공정률, 진도 부진 탐지, 지연 예측", "fix": "Data Date 기준 실적(착수·완료일, 공정률)을 입력한 뒤 P6에서 Schedule(F9) 후 내보내세요.", "tab": "daily"},
        {"key": "trades", "label": "공종 분류", "ok": bool(trades), "detail": (trades or {}).get("method", "자동(규칙) 추정"),
         "unlocks": "공종별 벤치마크·리스크 보정", "fix": "'공종 분류' 화면에서 AI 또는 규칙으로 분류를 확정하세요.", "tab": "trades"},
    ]
    return rows


# ---------------------------------------------------------------- ③ 상황판
def situation(uid: str, base_uid: str | None = None) -> dict:
    r = services.result(uid)
    bid, base = base_result(uid, base_uid)
    inc = [a for a in r["activities"] if a["status_code"] != "TK_Complete"]
    neg = [a for a in inc if a["tf"] is not None and a["tf"] < 0]
    hist = storage.history(r["name"])
    trend = [h for h in hist if h["data_date"] <= r["data_date"]][-8:]
    e = services.evm(uid, None)
    hs = services.health_score(uid)
    hs_b = services.health_score(bid) if bid else None
    margin = _dd(r["must_finish"], r["finish"])

    def kpi(key, label, value, prev=None, unit="", good="down", fmt=None, series=None):
        delta = None
        if isinstance(value, (int, float)) and isinstance(prev, (int, float)):
            delta = round(value - prev, 2)
        elif isinstance(value, str) and isinstance(prev, str) and len(value) == 10 and len(prev) == 10:
            delta = _dd(value, prev)
        return {"key": key, "label": label, "value": value, "prev": prev, "delta": delta, "unit": unit, "good": good, "series": series or []}

    bsum = base["summary"] if base else {}
    kpis = [
        kpi("finish", "예상 준공", r["finish"], base["finish"] if base else None, "일", "down",
            series=[_dd(h["result"]["finish"], trend[0]["result"]["finish"]) for h in trend] if trend else []),
        kpi("margin", "목표 대비 여유", margin, _dd(base["must_finish"], base["finish"]) if base else None, "일", "up"),
        kpi("progress", "공정률", r["summary"]["progress_pct"], bsum.get("progress_pct"), "%", "up",
            series=[h["result"]["summary"]["progress_pct"] for h in trend]),
        kpi("health", "건전성", hs, hs_b, "점", "up", series=[services.health_score(h["id"]) for h in trend]),
        kpi("spi", "SPI", e.get("spi") if e.get("available") else None, None, "", "up",
            series=[x["spi"] for x in e.get("history", [])] if e.get("available") else []),
        kpi("neg", "음수 여유 작업", len(neg), sum(1 for a in base["activities"] if a["status_code"] != "TK_Complete" and a["tf"] is not None and a["tf"] < 0) if base else None, "개", "down"),
    ]
    # 한 줄 상황
    parts = [f"예상 준공 {r['finish']}"]
    if base:
        slip = _dd(r["finish"], base["finish"])
        parts.append(f"직전 대비 {'+' if slip > 0 else ''}{slip}일" if slip else "직전과 같음")
    if margin is not None:
        parts.append(f"목표 대비 {'여유 ' + str(margin) if margin >= 0 else '지연 ' + str(-margin)}일")
    cause = None
    if base:
        d = services.delay(uid, bid)
        top = [x for x in d.get("top", []) if (x["introduced"] or 0) > 0]
        if top:
            cause = top[0]
            parts.append(f"주원인 {cause['code']} {cause['name']}(+{cause['introduced']}일)")
    level = status_level(r["name"], margin, len(neg), _dd(r["finish"], base["finish"]) if base else None, hs,
                         e.get("spi") if e.get("available") else None)
    # 이번 주 할 일
    today = date.today()
    todo = []
    for c in storage.rec_list("constraint", r["name"]):
        if c.get("status") != "해결" and c.get("due") and c["due"] <= (today + timedelta(days=7)).isoformat():
            todo.append({"level": "high" if c["due"] < today.isoformat() else "mid", "tab": "lookahead",
                         "text": f"제약 해소: {c.get('code')} {c.get('type')} - {(c.get('desc') or '')[:30]} (기한 {c['due']})"})
    this_week = (today - timedelta(days=today.weekday())).isoformat()
    pend = [c for c in storage.rec_list("commit", r["name"]) if c["week"] < this_week and not c.get("done") and not c.get("reason")]
    if pend:
        todo.append({"level": "mid", "tab": "lookahead", "text": f"지난주 약속 {len(pend)}건 완료 여부 입력"})
    for x in services.risks(uid):
        if x["status"] == "open" and not x.get("mitigation") and x["exposure_days"] >= 3:
            todo.append({"level": "mid", "tab": "risk", "text": f"리스크 대응 방안 작성: {x['title']} (노출 {x['exposure_days']}일)"})
    for a in sorted(neg, key=lambda a: a["tf"])[:3]:
        todo.append({"level": "high", "tab": "recovery", "text": f"음수 여유 {a['tf']}일: {a['code']} {a['name']} → 만회안 검토"})
    if cause:
        todo.append({"level": "mid", "tab": "analysis", "text": f"지연 원인 확인: {cause['code']} {cause['name']} (+{cause['introduced']}일)"})
    fails = [d for d in r["dcma"] if d["pass"] is False and d["threshold"] != "참고"]
    if len(fails) >= 5:
        todo.append({"level": "low", "tab": "health", "text": f"공정표 품질: DCMA 미달 {len(fails)}개 항목 정비"})
    order = {"high": 0, "mid": 1, "low": 2}
    todo.sort(key=lambda x: order[x["level"]])
    ready = readiness(uid)
    for kk in kpis:
        kk["series_label"] = f"최근 {len([v for v in kk['series'] if v is not None])}회 업데이트" if kk["series"] else ""
    so = signoffs(uid)
    return {"why": explain(uid, kpis), "review": so, "headline": ", ".join(parts), "level": level, "base_id": bid, "base_data_date": base["data_date"] if base else None,
            "kpis": kpis, "todo": todo[:5], "todo_total": len(todo), "readiness": ready,
            "readiness_missing": [x for x in ready if not x["ok"]],
            "milestones": [{"code": a["code"], "name": a["name"], "finish": a["act_end"] or a["finish"], "bl": a["bl_finish"],
                            "var": _dd(a["act_end"] or a["finish"], a["bl_finish"]), "done": a["status_code"] == "TK_Complete"}
                           for a in sorted([a for a in r["activities"] if a["milestone"]], key=lambda a: a["finish"])][:12]}


# ---------------------------------------------------------------- ⑧ 월간 업데이트 점검
def review(uid: str, base_uid: str | None = None) -> dict:
    r = services.result(uid)
    bid, base = base_result(uid, base_uid)
    steps = []
    imp = storage.get_extra(uid, "import_report") or {}
    p6 = r["p6_compare"]
    imp_issues = list(imp.get("warnings", [])) + list(r.get("warnings", []))
    if p6["checked"] and p6["match_pct"] < 90:
        imp_issues.append(f"P6 계산값과 일치율 {p6['match_pct']}% (계산 옵션이나 재계산 여부 확인)")
    steps.append({"key": "import", "title": "가져오기 점검", "ok": not imp_issues, "tab": "p6",
                  "summary": f"액티비티 {r['summary']['activities']}개, 관계 {r['summary']['relationships']}개" +
                             (f", P6 일치율 {p6['match_pct']}%" if p6["checked"] else ""), "issues": imp_issues[:8]})
    if base:
        f = services.forensic(uid, bid)
        ch, comp = f["changes"], f["compression"]
        risky = [x for x in ch["items"] if x["category"] in ("관계 삭제", "실착수일 변경", "실완료일 변경") or x["note"] in ("주공정 관계", "Lag 축소")]
        issues = [f"{k} {v}건" for k, v in ch["counts"].items()]
        if comp["suspected"]:
            issues.insert(0, f"공기 압축 의심: 최장경로 잔여공기 {comp['longest_path_cut_days']}일 단축, 준공일 변동 {comp['finish_slip']}일")
        steps.append({"key": "changes", "title": "변경·압축 확인", "ok": not comp["suspected"] and not risky, "tab": "analysis",
                      "summary": f"변경 {len(ch['items'])}건 (주의 {len(risky)}건)", "issues": issues[:8],
                      "detail": [f"{x['category']}: {x['code']} {x['before']} → {x['after']}" for x in risky[:10]]})
    else:
        steps.append({"key": "changes", "title": "변경·압축 확인", "ok": None, "tab": "analysis",
                      "summary": "비교할 이전 업데이트가 없습니다", "issues": []})
    hs = services.health(uid)
    hb = services.health_score(bid) if bid else None
    drop = hb is not None and hs["score"] < hb - 3
    steps.append({"key": "health", "title": "건전성", "ok": hs["score"] >= 75 and not drop, "tab": "health",
                  "summary": f"{hs['score']}점({hs['grade']})" + (f", 직전 {hb}점" if hb is not None else ""),
                  "issues": [f"{m['id']} {m['name']}: {m['value']}{'%' if m['unit'] == '%' else ''} (기준 {m['threshold']})"
                             for m in hs["metrics"] if m["pass"] is False][:8]})
    if base:
        d = services.delay(uid, bid)
        top = [x for x in d.get("top", []) if (x["introduced"] or 0) > 0][:5]
        steps.append({"key": "delay", "title": "지연 원인", "ok": d["finish_slip"] <= 0, "tab": "analysis",
                      "summary": f"준공 {'+' if d['finish_slip'] > 0 else ''}{d['finish_slip']}일 ({d['base_finish']} → {d['target_finish']})",
                      "issues": [f"{x['code']} {x['name']}: +{x['introduced']}일 {x['note']}" for x in top]})
    else:
        steps.append({"key": "delay", "title": "지연 원인", "ok": None, "tab": "analysis", "summary": "비교할 이전 업데이트가 없습니다", "issues": []})
    var = baseline_variance(r, None)
    steps.append({"key": "baseline", "title": "계획 대비", "ok": (var["project_var"] or 0) <= 0, "tab": "evm",
                  "summary": f"베이스라인 대비 준공 {var['project_var']}일, 지연 작업 {var['late_count']}개" if var["bl_project_finish"] else "베이스라인 없음",
                  "issues": [] if var["bl_project_finish"] else ["베이스라인이 없어 계획 대비 분석을 할 수 없습니다"]})
    steps.append({"key": "report", "title": "리포트 생성", "ok": None, "tab": "xlsx", "summary": "양식을 골라 엑셀 리포트를 만듭니다", "issues": []})
    return {"uid": uid, "name": r["name"], "data_date": r["data_date"], "base_id": bid,
            "base_data_date": base["data_date"] if base else None, "steps": steps}



# ---------------------------------------------------------------- ⑦ 월간 점검 팀 기록
def signoffs(uid: str) -> dict:
    r = storage.rec_get("review", uid)
    return {k: r.get(k) for k in ("steps", "completed_by", "completed_at")} if r else {"steps": {}, "completed_by": None, "completed_at": None}


def sign(uid: str, key: str, note: str, by: str, total_keys: list[str]) -> dict:
    from datetime import datetime
    name = services.result(uid)["name"]
    cur = signoffs(uid)
    steps = dict(cur.get("steps") or {})
    steps[key] = {"by": by, "at": datetime.now().isoformat(timespec="seconds"), "note": (note or "")[:500]}
    done = all(k in steps for k in total_keys)
    completed_by = cur.get("completed_by") or (by if done else None)
    completed_at = cur.get("completed_at") or (datetime.now().isoformat(timespec="seconds") if done else None)
    storage.rec_put("review", name, {"steps": steps, "completed_by": completed_by, "completed_at": completed_at}, by, rid=uid)
    if done and not cur.get("completed_by"):
        from . import notify
        r = services.result(uid)
        notify.push(notify.project_people(name), "review", f"'{name}' DD {r['data_date']} 월간 점검을 {by} 님이 완료했습니다", f"#/wizard/{uid}", exclude=by)
    return signoffs(uid)


# ---------------------------------------------------------------- ⑭ 지표 해석('왜?')
def explain(uid: str, kpis: list[dict]) -> dict:
    r = services.result(uid)
    out = {}
    e = services.evm(uid, None)
    if e.get("available") and e.get("spi") is not None and e["spi"] < 0.9 and e["bac"]:
        pv, ev = e["pv"] / e["bac"] * 100, e["ev"] / e["bac"] * 100
        acts = r["activities"]
        early_bl = sum(1 for a in acts if a["bl_finish"] and a["bl_finish"] <= r["data_date"])
        msg = f"계획상 예산의 {pv:.0f}%만큼 끝냈어야 하지만 실제는 {ev:.0f}%입니다."
        if early_bl > len(acts) * 0.5:
            msg += f" 계획 완료일이 Data Date 이전인 작업이 {early_bl}개({early_bl * 100 // max(len(acts), 1)}%)로 많아, 베이스라인이 실제 일정과 크게 다르면 SPI가 낮게 나옵니다. 베이스라인을 확인하세요."
        out["spi"] = {"text": msg, "tab": "evm"}
    hs = services.health(uid)
    fails = sorted([m for m in hs["metrics"] if m["pass"] is False], key=lambda m: -m["weight"])[:3]
    if fails:
        out["health"] = {"text": "감점이 큰 항목: " + ", ".join(f"{m['name']}({m['value']}{'%' if m['unit'] == '%' else ''})" for m in fails), "tab": "health"}
    k = {x["key"]: x for x in kpis}
    if (k.get("margin", {}).get("value") or 0) < 0 or (k.get("finish", {}).get("delta") or 0) > 0:
        lp = [a for a in r["activities"] if a["longest"] and a["status_code"] != "TK_Complete"][:3]
        out["finish"] = {"text": "준공을 결정하는 최장경로 앞쪽 작업: " + ", ".join(f"{a['code']} {a['name']}" for a in lp), "tab": "critical"}
    neg = [a for a in r["activities"] if a["tf"] is not None and a["tf"] < 0]
    if neg:
        out["neg"] = {"text": f"가장 급한 작업: {min(neg, key=lambda a: a['tf'])['code']} (여유 {min(a['tf'] for a in neg)}일). 자동 만회안으로 대책을 찾을 수 있습니다.", "tab": "recovery"}
    return out


def my_tasks(username: str) -> list[dict]:
    """내게 배정된 일: 리스크·제약 담당, 해결되지 않은 멘션."""
    out = []
    for p in storage.latest_by_project():
        name, uid = p["name"], p["id"]
        for x in storage.rec_list("risk", name):
            if x.get("assignee") == username and x.get("status") != "closed":
                out.append({"kind": "리스크", "project": name, "uid": uid, "tab": "risk", "text": x["title"], "due": x.get("due"), "id": x["id"], "record": x})
        for c in storage.rec_list("constraint", name):
            if c.get("assignee") == username and c.get("status") != "해결":
                out.append({"kind": "제약", "project": name, "uid": uid, "tab": "lookahead", "text": f"{c.get('code')} {c.get('type')} - {c.get('desc', '')}", "due": c.get("due"), "id": c["id"], "record": c})
        for m in storage.rec_list("comment", name):
            if username in (m.get("mentions") or []) and not m.get("resolved"):
                out.append({"kind": "멘션", "project": name, "uid": uid, "tab": "overview", "text": f"{m['author']}: {m['text'][:60]}", "due": None,
                            "id": m["id"], "target": m.get("target")})
    return sorted(out, key=lambda x: (x["due"] or "9999", x["project"]))


# ---------------------------------------------------------------- 6차: 상태 기준(프로젝트별), 타임라인
TH_DEFAULT = {"margin_bad": 0, "margin_warn": None, "health_bad": None, "health_warn": None, "spi_warn": None, "slip_warn": 1}


def thresholds(name: str) -> dict:
    t = dict(TH_DEFAULT)
    t.update({k: v for k, v in (storage.setting(name, "status_thresholds", {}) or {}).items() if k in TH_DEFAULT})
    return t


def clean_thresholds(body: dict) -> dict:
    out = {}
    for k in TH_DEFAULT:
        v = body.get(k)
        if v in (None, ""):
            continue
        out[k] = float(v) if k == "spi_warn" else int(v)
    return out


def status_level(name: str, margin, neg: int, slip, health, spi) -> str:
    """정상(ok)·주의(warn)·위험(bad) 판정. 프로젝트별 기준값을 쓰고, 지정하지 않은 기준은 판정에 쓰지 않는다."""
    t = thresholds(name)
    lt = lambda v, th: v is not None and th is not None and v < th  # noqa: E731
    if lt(margin, t["margin_bad"]) or neg or lt(health, t["health_bad"]):
        return "bad"
    if (slip is not None and t["slip_warn"] is not None and slip >= t["slip_warn"]) or lt(margin, t["margin_warn"]) \
            or lt(health, t["health_warn"]) or lt(spi, t["spi_warn"]):
        return "warn"
    return "ok"


def timeline(name: str) -> list[dict]:
    """프로젝트의 월별 이력: 준공 변화, 점검, 코멘트, 출력물, 확정본."""
    ups = {u["id"]: u for u in storage.listing() if u["name"] == name}
    hist = storage.history(name)
    comments = storage.rec_list("comment", name)
    outputs = storage.rec_list("report_log", name)
    finals = {f["upload_id"]: f for f in storage.rec_list("final", name)}
    out, prev = [], None
    for i, h in enumerate(hist):
        r = h["result"]
        start = h.get("created_at") or ""
        end = hist[i + 1].get("created_at") if i + 1 < len(hist) else "9999"
        so = signoffs(h["id"])
        u = ups.get(h["id"], {})
        out.append({
            "id": h["id"], "data_date": h["data_date"], "finish": r["finish"], "created_at": start,
            "uploader": u.get("uploader"), "note": u.get("note") or u.get("filename"),
            "slip": _dd(r["finish"], prev["finish"]) if prev else None,
            "progress": r["summary"]["progress_pct"], "health": services.health_score(h["id"]),
            "neg": sum(1 for a in r["activities"] if a["status_code"] != "TK_Complete" and a["tf"] is not None and a["tf"] < 0),
            "review": {"steps": len(so.get("steps") or {}), "completed_by": so.get("completed_by"), "completed_at": so.get("completed_at"),
                       "notes": [{"key": k, **v} for k, v in (so.get("steps") or {}).items() if v.get("note")]},
            "comments": [{"author": c["author"], "text": c["text"][:120], "resolved": c.get("resolved")}
                         for c in comments if start <= c["created_at"] < end][:5],
            "outputs": [{"type": o.get("type") or "엑셀 양식", "author": o["author"], "created_at": o["created_at"]} for o in outputs if o.get("upload_id") == h["id"]],
            "final": finals.get(h["id"]),
        })
        prev = r
    return list(reversed(out))
