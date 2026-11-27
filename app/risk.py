"""리스크 레지스터 기반 몬테카를로 + 민감도(Tornado) 분석."""
from __future__ import annotations

import random
import statistics
import time
from collections import defaultdict
from datetime import date, timedelta

from .schedule import Schedule

DEFAULT_RANGE = (0.9, 1.0, 1.35)


def simulate(s: Schedule, risks: list[dict], iterations: int = 500, ranges: dict | None = None,
             trade_of: dict | None = None, seed: int = 11, time_limit: float = 25.0,
             uncertainty: bool = True) -> dict:
    """risks: [{id,title,prob(0~100),impact_min,impact_ml,impact_max,codes:[...],status}] (일 단위)."""
    rng = random.Random(seed)
    ranges, trade_of = ranges or {}, trade_of or {}
    by_code = {a.code: a for a in s.acts.values()}
    base = {a.id: a.rem_dur for a in s.acts.values()}
    open_risks = [r for r in risks if r.get("status", "open") != "closed" and r.get("codes")]
    finishes, crit = [], defaultdict(int)
    occur = {r["id"]: [] for r in open_risks}
    dur_samples = defaultdict(list)
    t0 = time.time()
    try:
        for _ in range(iterations):
            for a in s.acts.values():
                d = base[a.id]
                if d > 0 and a.status != "TK_Complete" and uncertainty:
                    lo, ml, hi = ranges.get(trade_of.get(a.code, ""), DEFAULT_RANGE)
                    a.rem_dur = max(1, round(d * rng.triangular(lo, hi, ml)))
                else:
                    a.rem_dur = d
            for r in open_risks:
                hit = rng.random() * 100 < float(r.get("prob") or 0)
                occur[r["id"]].append(hit)
                if hit:
                    lo, ml, hi = (float(r.get("impact_min") or 0), float(r.get("impact_ml") or 0),
                                  float(r.get("impact_max") or 0))
                    hi = max(hi, ml, lo)
                    imp = round(rng.triangular(lo, hi, min(max(ml, lo), hi))) if hi > lo else round(lo)
                    for c in r["codes"]:
                        a = by_code.get(c)
                        if a and a.status != "TK_Complete":
                            a.rem_dur += imp
            s.compute()
            finishes.append(s.finish - 1)
            for a in s.acts.values():
                if a.longest:
                    crit[a.code] += 1
                if base[a.id] > 0 and a.status != "TK_Complete":
                    dur_samples[a.code].append(a.rem_dur)
            if time.time() - t0 > time_limit:
                break
    finally:
        for a in s.acts.values():
            a.rem_dur = base[a.id]
        s.compute()
    n = len(finishes)
    srt = sorted(finishes)
    pct = lambda p: date.fromordinal(srt[min(n - 1, int(p / 100 * n))]).isoformat()
    # 리스크 민감도: 발생 시 평균 준공 - 미발생 시 평균 준공
    tornado = []
    for r in open_risks:
        hits = occur[r["id"]]
        yes = [f for f, h in zip(finishes, hits) if h]
        no = [f for f, h in zip(finishes, hits) if not h]
        if yes and no:
            tornado.append({"type": "risk", "id": r["id"], "label": r.get("title", ""),
                            "impact_days": round(statistics.mean(yes) - statistics.mean(no), 1),
                            "occurrence": round(100 * len(yes) / n, 1)})
    # 작업 공기 민감도: 공기 샘플과 준공일의 상관계수
    names = {a.code: a.name for a in s.acts.values()}
    for c, xs in dur_samples.items():
        if len(xs) == n and n > 10 and len(set(xs)) > 1:
            try:
                corr = statistics.correlation(xs, finishes)
            except statistics.StatisticsError:
                continue
            if corr > 0.05:
                tornado.append({"type": "activity", "id": c, "label": f"{c} {names.get(c, '')}",
                                "correlation": round(corr, 2)})
    risks_t = sorted([t for t in tornado if t["type"] == "risk"], key=lambda t: -t["impact_days"])
    acts_t = sorted([t for t in tornado if t["type"] == "activity"], key=lambda t: -t["correlation"])[:15]
    hist = defaultdict(int)
    for f in finishes:
        d = date.fromordinal(f)
        hist[(d - timedelta(days=d.weekday())).isoformat()] += 1
    target = s.must_finish
    return {
        "iterations": n, "deterministic": date.fromordinal(s.finish - 1).isoformat(),
        "p10": pct(10), "p50": pct(50), "p80": pct(80), "p90": pct(90),
        "mean": date.fromordinal(round(statistics.mean(finishes))).isoformat(),
        "must_finish": target.isoformat() if target else None,
        "prob_meet_target": round(100 * sum(1 for f in finishes if f <= target.toordinal()) / n, 1) if target else None,
        "histogram": sorted(hist.items()), "risk_tornado": risks_t, "activity_tornado": acts_t,
        "criticality": sorted([{"code": c, "name": names.get(c, ""), "index": round(100 * k / n, 1)}
                               for c, k in crit.items()], key=lambda x: -x["index"])[:30],
        "risks_used": len(open_risks), "uncertainty": uncertainty,
    }
