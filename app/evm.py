"""베이스라인 편차, EVM(획득가치), 자원 히스토그램."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from .schedule import Schedule
from .xer_parser import parse_float


def baseline_variance(current: dict, baseline: dict | None) -> dict:
    """baseline 이 None 이면 XER 의 계획(Target) 날짜를 베이스라인으로 사용."""
    mb = {a["code"]: a for a in baseline["activities"]} if baseline else {}
    rows = []
    for a in current["activities"]:
        if baseline:
            b = mb.get(a["code"])
            bs, bf = (b["start"], b["finish"]) if b else (None, None)
        else:
            bs, bf = a["bl_start"], a["bl_finish"]
        if not bf:
            continue
        cs = a["act_start"] or a["start"]
        cf = a["act_end"] or a["finish"]
        rows.append({"code": a["code"], "name": a["name"], "status": a["status"], "longest": a["longest"],
                     "bl_start": bs, "bl_finish": bf, "start": cs, "finish": cf,
                     "start_var": (date.fromisoformat(cs) - date.fromisoformat(bs)).days if bs else None,
                     "finish_var": (date.fromisoformat(cf) - date.fromisoformat(bf)).days})
    rows.sort(key=lambda r: -(r["finish_var"] or 0))
    late = [r for r in rows if r["finish_var"] > 0]
    bl_finish = (max(mb[c]["finish"] for c in mb) if baseline else
                 max((a["bl_finish"] for a in current["activities"] if a["bl_finish"]), default=None))
    return {"source": baseline["data_date"] if baseline else "Target", "bl_project_finish": bl_finish,
            "project_finish": current["finish"],
            "project_var": (date.fromisoformat(current["finish"]) - date.fromisoformat(bl_finish)).days if bl_finish else None,
            "late_count": len(late), "rows": rows}


def _cost(row: dict, *keys) -> float:
    return sum(parse_float(row.get(k)) for k in keys)


def evm(s: Schedule, result: dict, baseline: dict | None = None) -> dict:
    by_id = {a.id: a for a in s.acts.values()}
    bac_by = defaultdict(float)
    ac_by = defaultdict(float)
    etc_by = defaultdict(float)
    for r in s.assignments:
        t = r.get("task_id")
        bac_by[t] += _cost(r, "target_cost")
        ac_by[t] += _cost(r, "act_reg_cost", "act_ot_cost")
        etc_by[t] += _cost(r, "remain_cost")
    bac = sum(bac_by.values())
    if bac <= 0:
        return {"available": False, "message": "XER에 자원·비용(TASKRSRC target_cost) 정보가 없어 EVM을 계산할 수 없습니다."}
    res = {a["code"]: a for a in result["activities"]}
    bl = {a["code"]: a for a in baseline["activities"]} if baseline else None

    def planned_frac(a, t: int) -> float:
        if bl:
            b = bl.get(a.code)
            s0, f0 = (b["start"], b["finish"]) if b else (None, None)
        else:
            s0 = a.target_start.isoformat() if a.target_start else None
            f0 = a.target_end.isoformat() if a.target_end else None
        if not s0 or not f0:
            return 0.0
        o0, o1 = date.fromisoformat(s0).toordinal(), date.fromisoformat(f0).toordinal() + 1
        if t >= o1:
            return 1.0
        if t <= o0:
            return 0.0
        return (t - o0) / max(o1 - o0, 1)

    ddo = s.data_date.toordinal()
    pv = sum(bac_by[t] * planned_frac(by_id[t], ddo) for t in bac_by if t in by_id)
    ev = sum(bac_by[t] * min(max(by_id[t].pct, 0), 100) / 100 for t in bac_by if t in by_id)
    ac = sum(ac_by.values())
    etc = sum(etc_by.values())
    spi = ev / pv if pv else None
    cpi = ev / ac if ac else None
    # PV 곡선 (주 단위)
    starts = [by_id[t] for t in bac_by if t in by_id]
    lo = min(min(a.es for a in starts), ddo)
    hi = max(max(a.lf for a in starts), ddo)
    pts = list(range(lo, hi + 7, 7))
    curve = [{"date": date.fromordinal(t).isoformat(),
              "pv": round(sum(bac_by[x] * planned_frac(by_id[x], t) for x in bac_by if x in by_id)),
              "forecast": round(sum(bac_by[x] * _early_frac(by_id[x], t, ddo) for x in bac_by if x in by_id))}
             for t in pts]
    worst = sorted([{"code": by_id[t].code, "name": by_id[t].name, "bac": round(bac_by[t]),
                     "ev": round(bac_by[t] * by_id[t].pct / 100), "ac": round(ac_by[t]),
                     "cv": round(bac_by[t] * by_id[t].pct / 100 - ac_by[t])}
                    for t in bac_by if t in by_id and ac_by[t] > 0], key=lambda x: x["cv"])[:20]
    return {"available": True, "bac": round(bac), "pv": round(pv), "ev": round(ev), "ac": round(ac),
            "etc": round(etc), "eac": round(ac + etc), "eac_cpi": round(bac / cpi) if cpi else None,
            "sv": round(ev - pv), "cv": round(ev - ac),
            "spi": round(spi, 2) if spi else None, "cpi": round(cpi, 2) if cpi else None,
            "vac": round(bac - (ac + etc)), "curve": curve, "worst_cv": worst,
            "baseline": baseline["data_date"] if baseline else "Target"}


def _early_frac(a, t: int, ddo: int) -> float:
    """현재 일정(Early) 기준 누적 진척 예측: Data Date 이전은 실적 공정률, 이후는 잔여를 선형 배분."""
    done = min(max(a.pct, 0), 100) / 100
    if t <= ddo:
        return done if t >= ddo else 0.0 if a.es >= t else done * (t - a.es) / max(ddo - a.es, 1)
    start = max(a.es, ddo)
    if t >= a.ef:
        return 1.0
    if t <= start:
        return done
    return done + (1 - done) * (t - start) / max(a.ef - start, 1)


def histogram(s: Schedule) -> dict:
    """자원별 주간 잔여 물량(early 일정에 선형 배분)."""
    by_id = {a.id: a for a in s.acts.values()}
    weeks = defaultdict(lambda: defaultdict(float))
    names = {}
    for r in s.assignments:
        a = by_id.get(r.get("task_id"))
        if not a or a.status == "TK_Complete":
            continue
        qty = parse_float(r.get("remain_qty"))
        if qty <= 0:
            continue
        rid = r.get("rsrc_id")
        rs = s.resources.get(rid, {})
        names[rid] = rs.get("rsrc_name") or rs.get("rsrc_short_name") or f"자원 {rid}"
        c = s.cal(a)
        start = max(a.es, s.data_date.toordinal())
        n = max(1, c.workdays_between(start, a.ef))
        i0 = c.co(start)
        for k in range(n):
            d = date.fromordinal(c.start_of(i0 + k))
            wk = (d - timedelta(days=d.weekday())).isoformat()
            weeks[rid][wk] += qty / n
    all_weeks = sorted({w for v in weeks.values() for w in v})
    return {"weeks": all_weeks,
            "series": [{"id": rid, "name": names[rid], "values": [round(weeks[rid].get(w, 0), 1) for w in all_weeks],
                        "peak": round(max(weeks[rid].values()), 1)} for rid in weeks]}
