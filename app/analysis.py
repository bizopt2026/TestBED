"""공정 분석: DCMA 14-Point 점검, 요약 지표, S-Curve, P6 일정 비교."""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta

from .schedule import HARD_CONSTRAINTS, MILESTONES, Schedule

HIGH_DAYS = 44


def _pct(n: int, d: int) -> float:
    return round(100.0 * n / d, 1) if d else 0.0


def dcma(s: Schedule) -> list[dict]:
    acts = list(s.acts.values())
    inc = [a for a in acts if a.status != "TK_Complete"]
    inc_tasks = [a for a in inc if a.task_type not in MILESTONES and a.task_type != "TT_LOE"
                 and a.task_type != "TT_WBS"]
    n_inc = len(inc) or 1
    rels = s.rels
    dd = s.data_date
    ddo = dd.toordinal()
    code = lambda xs: [a.code for a in xs][:200]

    no_pred = [a for a in inc if not a.preds]
    no_succ = [a for a in inc if not a.succs]
    missing_logic = list({a.id: a for a in no_pred + no_succ}.values())
    # 프로젝트 시작/종료 마일스톤 1개씩은 허용
    leads = [r for r in rels if r.lag < 0]
    lags = [r for r in rels if r.lag > 0]
    non_fs = [r for r in rels if r.type != "FS"]
    hard = [a for a in inc if a.cstr_type in HARD_CONSTRAINTS or a.cstr_type2 in HARD_CONSTRAINTS]
    high_float = [a for a in inc if a.tf > HIGH_DAYS]
    neg_float = [a for a in inc if a.tf < 0]
    high_dur = [a for a in inc_tasks if a.orig_dur > HIGH_DAYS]
    invalid = [a for a in acts
               if (a.act_start and a.act_start > dd) or (a.act_end and a.act_end > dd)
               or (a.status != "TK_Complete" and a.ef < ddo and a.rem_dur > 0)]
    no_rsrc = [a for a in inc_tasks if not a.has_resource]
    bl_due = [a for a in acts if a.target_end and a.target_end <= dd]
    missed = [a for a in bl_due if not a.act_end or a.act_end > a.target_end]
    completed_due = [a for a in bl_due if a.status == "TK_Complete"]

    cp_len = s.default_cal.workdays_between(ddo, s.finish)
    if s.must_finish:
        cp_tf = s.default_cal.workdays_between(s.finish, s.must_finish.toordinal() + 1)
    else:
        cp_tf = 0
    cpli = round((cp_len + cp_tf) / cp_len, 2) if cp_len > 0 else 1.0
    bei = round(len(completed_due) / len(bl_due), 2) if bl_due else None
    has_cp = any(a.longest for a in inc)

    def item(no, name, desc, count, total, threshold, ok, items=None, unit="%", value=None):
        return {"no": no, "name": name, "desc": desc, "count": count, "total": total,
                "value": value if value is not None else _pct(count, total),
                "threshold": threshold, "unit": unit, "pass": ok, "items": items or []}

    nr = len(rels) or 1
    return [
        item(1, "Logic (논리 누락)", "선행 또는 후행 관계가 없는 미완료 액티비티", len(missing_logic), n_inc,
             "≤ 5%", _pct(len(missing_logic), n_inc) <= 5, code(missing_logic)),
        item(2, "Leads (음수 Lag)", "음수 Lag 관계", len(leads), nr, "0개", len(leads) == 0,
             [f"{s.acts[r.pred].code} → {s.acts[r.succ].code} ({r.lag}d)" for r in leads][:200]),
        item(3, "Lags (양수 Lag)", "양수 Lag 관계 비율", len(lags), nr, "≤ 5%", _pct(len(lags), nr) <= 5,
             [f"{s.acts[r.pred].code} → {s.acts[r.succ].code} (+{r.lag}d)" for r in lags][:200]),
        item(4, "Relationship Types", "FS 이외(SS/FF/SF) 관계 비율 (FS ≥ 90% 권장)", len(non_fs), nr,
             "≤ 10%", _pct(len(non_fs), nr) <= 10,
             [f"{s.acts[r.pred].code} → {s.acts[r.succ].code} ({r.type})" for r in non_fs][:200]),
        item(5, "Hard Constraints", "강제 제약조건(MSO/MFO/SNLT/FNLT/Mandatory)", len(hard), n_inc,
             "≤ 5%", _pct(len(hard), n_inc) <= 5, code(hard)),
        item(6, "High Float", f"Total Float > {HIGH_DAYS}일", len(high_float), n_inc, "≤ 5%",
             _pct(len(high_float), n_inc) <= 5, code(high_float)),
        item(7, "Negative Float", "Total Float < 0", len(neg_float), n_inc, "0개", len(neg_float) == 0,
             code(neg_float)),
        item(8, "High Duration", f"원 공기 > {HIGH_DAYS}일 (미완료 작업)", len(high_dur), len(inc_tasks) or 1,
             "≤ 5%", _pct(len(high_dur), len(inc_tasks) or 1) <= 5, code(high_dur)),
        item(9, "Invalid Dates", "Data Date 이후 실적일 / Data Date 이전 예정일", len(invalid), len(acts) or 1,
             "0개", len(invalid) == 0, code(invalid)),
        item(10, "Resources", "자원 미배정 작업 (참고)", len(no_rsrc), len(inc_tasks) or 1, "참고",
             True, code(no_rsrc)),
        item(11, "Missed Tasks", "계획(Target) 완료일 경과했으나 기한 내 미완료", len(missed), len(bl_due) or 1,
             "≤ 5%", _pct(len(missed), len(bl_due) or 1) <= 5, code(missed)),
        item(12, "Critical Path Test", "Data Date부터 프로젝트 종료까지 연속된 주공정 존재", 0 if has_cp else 1, 1,
             "통과", has_cp, [], unit="", value="존재" if has_cp else "없음"),
        item(13, "CPLI", "(주공정 길이 + 주공정 여유) / 주공정 길이", 0, 0, "≥ 0.95", cpli >= 0.95,
             [], unit="", value=cpli),
        item(14, "BEI", "기한 도래 작업 중 완료 비율 (완료/계획)", len(completed_due), len(bl_due), "≥ 0.95",
             bei is None or bei >= 0.95, [], unit="", value=bei if bei is not None else "N/A"),
    ]


def summary(s: Schedule) -> dict:
    acts = list(s.acts.values())
    st = Counter(a.status for a in acts)
    tot_dur = sum(a.orig_dur for a in acts) or 1
    earned = sum(a.orig_dur * min(max(a.pct, 0), 100) / 100 for a in acts)
    inc = [a for a in acts if a.status != "TK_Complete"]
    start = min((a.es for a in acts), default=None)
    return {
        "activities": len(acts), "relationships": len(s.rels),
        "not_started": st.get("TK_NotStart", 0), "in_progress": st.get("TK_Active", 0),
        "completed": st.get("TK_Complete", 0),
        "milestones": sum(1 for a in acts if a.task_type in MILESTONES),
        "critical": sum(1 for a in inc if a.critical),
        "longest_path": sum(1 for a in inc if a.longest),
        "progress_pct": round(100 * earned / tot_dur, 1),
        "start": date.fromordinal(start).isoformat() if start else None,
        "remaining_workdays": s.default_cal.workdays_between(s.data_date.toordinal(), s.finish),
        "calendars": [c.name for c in s.calendars.values()],
        "loops": s.loops,
    }


def s_curve(s: Schedule) -> dict:
    """원 공기 가중치 기반 누적 공정률: 계획(Target) / 조기(Early) / 만기(Late)."""
    acts = [a for a in s.acts.values() if a.orig_dur > 0]
    if not acts:
        return {"dates": [], "baseline": [], "early": [], "late": []}
    total = sum(a.orig_dur for a in acts)
    lo = min(min(a.es, (a.target_start or date.max).toordinal()) for a in acts)
    hi = max(max(a.lf, a.ef, (a.target_end or date.min).toordinal() + 1) for a in acts)
    step = max(1, (hi - lo) // 120)
    pts = list(range(lo, hi + step, step))

    def curve(span):
        out = []
        for t in pts:
            v = 0.0
            for a in acts:
                rng = span(a)
                if not rng:
                    continue
                a0, a1 = rng
                if t >= a1:
                    v += a.orig_dur
                elif t > a0:
                    v += a.orig_dur * (t - a0) / (a1 - a0)
            out.append(round(100 * v / total, 2))
        return out

    def bl(a):
        if a.target_start and a.target_end:
            return a.target_start.toordinal(), max(a.target_end.toordinal() + 1, a.target_start.toordinal() + 1)
        return None

    return {
        "dates": [date.fromordinal(t).isoformat() for t in pts],
        "baseline": curve(bl),
        "early": curve(lambda a: (a.es, max(a.ef, a.es + 1))),
        "late": curve(lambda a: (a.ls, max(a.lf, a.ls + 1))),
        "data_date": s.data_date.isoformat(),
        "actual_pct": summary(s)["progress_pct"],
    }


def compare_p6(s: Schedule, acts_dict: list[dict]) -> dict:
    """XER 에 저장된 P6 계산 결과와 본 엔진 결과 비교 (검증용)."""
    diffs = []
    match = 0
    checked = 0
    for a in acts_dict:
        if a["status_code"] == "TK_Complete" or not a["p6_start"]:
            continue
        checked += 1
        ds = (date.fromisoformat(a["start"]) - date.fromisoformat(a["p6_start"])).days
        df = (date.fromisoformat(a["finish"]) - date.fromisoformat(a["p6_finish"])).days \
            if a["p6_finish"] else 0
        dtf = round(a["tf"] - a["p6_tf"], 1) if a["p6_tf"] is not None and a["tf"] is not None else 0
        if ds == 0 and df == 0 and abs(dtf) < 1:
            match += 1
        else:
            diffs.append({"id": a["id"], "code": a["code"], "name": a["name"],
                          "start": a["start"], "p6_start": a["p6_start"], "d_start": ds,
                          "finish": a["finish"], "p6_finish": a["p6_finish"], "d_finish": df,
                          "tf": a["tf"], "p6_tf": a["p6_tf"], "d_tf": dtf})
    diffs.sort(key=lambda x: -abs(x["d_finish"]))
    return {"checked": checked, "match": match,
            "match_pct": _pct(match, checked), "diffs": diffs[:500]}


def analyze(s: Schedule) -> dict:
    d = s.to_dict()
    d["summary"] = summary(s)
    d["dcma"] = dcma(s)
    d["s_curve"] = s_curve(s)
    d["p6_compare"] = compare_p6(s, d["activities"])
    return d
