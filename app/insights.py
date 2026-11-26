"""규칙·통계 기반 분석 (AI 없이도 동작하는 결정론적 계층).

AI 기능은 이 모듈의 결과(숫자)를 근거로 해설·문장화만 담당한다.
"""
from __future__ import annotations

import random
import re
import statistics
import time
from collections import defaultdict
from datetime import date, timedelta

from .schedule import HARD_CONSTRAINTS, MILESTONES, Schedule

# ---------------------------------------------------------------- 공종 분류
TRADES = ["설계/인허가", "가설/착공", "토목", "기초", "철근콘크리트", "철골", "외장/지붕", "마감",
          "기계설비", "전기/통신", "소방", "조경/부대", "구매/제작", "시운전/준공", "기타"]

TRADE_RULES = [
    ("시운전/준공", r"시운전|준공|사용승인|인수인계|commission|handover|test|검사|TAB"),
    ("설계/인허가", r"설계|인허가|허가|승인도|도면|design|permit|approval|submittal"),
    ("구매/제작", r"구매|발주|제작|납품|입고|procure|fabricat|deliver|PO\b"),
    ("소방", r"소방|스프링클러|fire|sprinkler"),
    ("전기/통신", r"전기|간선|배선|조명|통신|수변전|케이블|electric|cable|light|telecom|CCTV"),
    ("기계설비", r"기계|배관|덕트|공조|위생|설비|mechanical|piping|duct|HVAC|plumb"),
    ("철골", r"철골|steel|데크|deck"),
    ("철근콘크리트", r"철근|거푸집|타설|양생|슬래브|콘크리트|rebar|formwork|concrete|slab|pour"),
    ("기초", r"기초|파일|말뚝|터파기|foundation|pile|footing|excavat"),
    ("토목", r"토목|부지|정지|측량|토공|흙막이|배수|우수|오수|earth|grading|survey|civil"),
    ("외장/지붕", r"외벽|지붕|패널|커튼월|방수|roof|cladding|facade|curtain"),
    ("마감", r"마감|도장|에폭시|타일|천장|수장|창호|도어|레벨러|finish|paint|epoxy|tile|ceiling|door"),
    ("조경/부대", r"조경|포장|부대|외構|landscape|paving|fence"),
    ("가설/착공", r"가설|착공|현장사무소|울타리|mobiliz|temporary|site office|NTP"),
]


def classify_rule(name: str, wbs: str = "") -> str:
    text = f"{name} {wbs}"
    for trade, pat in TRADE_RULES:
        if re.search(pat, name, re.I):
            return trade
    for trade, pat in TRADE_RULES:
        if re.search(pat, text, re.I):
            return trade
    return "기타"


# ---------------------------------------------------------------- DCMA 조치 가이드
def _act(s: Schedule, code: str):
    return next((a for a in s.acts.values() if a.code == code), None)


def suggest_relationships(s: Schedule, limit_per_act: int = 3) -> list[dict]:
    """선행/후행이 없는 미완료 액티비티에 연결할 후보 관계를 점수화해 추천."""
    acts = [a for a in s.acts.values()]
    out = []
    seq_pairs = [(r"철근|거푸집", r"타설"), (r"타설", r"양생"), (r"양생", r"세우기|거푸집 해체|조적"),
                 (r"터파기", r"철근|버림|기초"), (r"제작", r"설치|세우기|반입"), (r"배관|배선|덕트", r"마감|천장|시운전"),
                 (r"설치", r"시운전|검사"), (r"시운전", r"검사|준공"), (r"검사", r"준공|사용승인")]
    order = sorted(acts, key=lambda a: (a.es, a.code))
    pos = {a.id: i for i, a in enumerate(order)}

    def score(p, q):
        sc, why = 0.0, []
        if p.wbs_id and p.wbs_id == q.wbs_id:
            sc += 3; why.append("같은 WBS")
        for a_pat, b_pat in seq_pairs:
            if re.search(a_pat, p.name) and re.search(b_pat, q.name):
                sc += 5; why.append("작업 순서 패턴")
                break
        gap = q.es - p.ef
        if 0 <= gap <= 30:
            sc += 2; why.append("일정상 인접")
        elif gap < 0 and q.es >= p.es:
            sc += 0.5
        else:
            sc -= 1
        return sc, why

    for a in acts:
        if a.status == "TK_Complete":
            continue
        needs = []
        if not a.succs and a.task_type != "TT_FinMile":
            needs.append("succ")
        if not a.preds and a.task_type != "TT_Mile":
            needs.append("pred")
        for need in needs:
            cands = []
            for b in order:
                if b.id == a.id:
                    continue
                if need == "succ" and b.status != "TK_Complete" and b.es >= a.es:
                    sc, why = score(a, b)
                    cands.append((sc, b, why))
                elif need == "pred" and b.es <= a.es:
                    sc, why = score(b, a)
                    cands.append((sc, b, why))
            if need == "succ":
                for b in order:  # 후행이 없으면 준공(종료) 마일스톤 연결도 후보
                    if b.task_type == "TT_FinMile" and not b.succs and b.id != a.id and b.es >= a.es:
                        cands.append((2.9, b, ["프로젝트 종료 마일스톤"]))
            cands.sort(key=lambda x: (-x[0], abs(pos[x[1].id] - pos[a.id])))
            for sc, b, why in cands[:limit_per_act]:
                if sc < 2.5:
                    continue
                pred, succ = (a, b) if need == "succ" else (b, a)
                out.append({"target": a.code, "target_name": a.name, "missing": "후행" if need == "succ" else "선행",
                            "pred": pred.code, "pred_name": pred.name, "succ": succ.code, "succ_name": succ.name,
                            "type": "FS", "lag": 0, "score": round(sc, 1), "reasons": why})
    return out


def dcma_guides(s: Schedule, dcma: list[dict]) -> dict[int, list[str]]:
    """DCMA 미달 항목별 구체적 조치 가이드 (규칙 기반)."""
    g: dict[int, list[str]] = defaultdict(list)
    by_no = {d["no"]: d for d in dcma}
    if not by_no[1]["pass"]:
        sugg = suggest_relationships(s, 1)
        for x in sugg[:15]:
            g[1].append(f"{x['target']} {x['target_name']}: {x['missing']} 관계 없음 → "
                        f"{x['pred']} → {x['succ']} FS 연결 검토 ({', '.join(x['reasons']) or '일정 순서'})")
        g[1].append("관계 추천 화면에서 후보를 검토하고 승인하면 수정된 XER을 내려받을 수 있습니다.")
    if not by_no[2]["pass"]:
        g[2].append("음수 Lag(Lead)는 후행이 선행 종료 전에 시작한다는 뜻이라 진도 판단을 흐립니다. "
                    "선행 작업을 분할하거나 SS + 양수 Lag로 바꾸세요.")
        g[2] += [f"{x} 관계 재검토" for x in by_no[2]["items"][:10]]
    if not by_no[3]["pass"]:
        g[3].append("Lag가 대기(양생·건조)를 뜻하면 별도 액티비티로 만들어 가시화하세요. 단순 일정 조정용 Lag는 제거를 검토하세요.")
    if not by_no[4]["pass"]:
        g[4].append("SS/FF 관계가 많으면 주공정 추적이 어려워집니다. 작업을 단계별로 분할해 FS로 바꾸는 것을 우선 검토하세요.")
    if not by_no[5]["pass"]:
        g[5].append("강제 제약(Must Start/Finish 등)은 논리를 무시하고 일정을 고정합니다. "
                    "Start On or After 같은 약한 제약으로 바꾸거나 근거를 기록하세요.")
        g[5] += [f"{c}: 제약 근거 확인" for c in by_no[5]["items"][:10]]
    if not by_no[6]["pass"]:
        g[6].append("여유가 44일을 넘는 작업은 대부분 후행 관계 누락이 원인입니다. 아래 작업의 후행 연결을 확인하세요.")
        g[6] += by_no[6]["items"][:10]
    if not by_no[7]["pass"]:
        lp = sorted([a for a in s.acts.values() if a.tf < 0 and a.status != "TK_Complete"], key=lambda a: a.tf)[:5]
        g[7].append("음수 여유는 목표 준공일을 지킬 수 없다는 뜻입니다. What-if 화면에서 아래 작업의 공기 단축이나 병행 작업을 검토하세요.")
        g[7] += [f"{a.code} {a.name} (TF {a.tf}일, 잔여 {a.rem_dur}일)" for a in lp]
    if not by_no[8]["pass"]:
        g[8].append("44일을 넘는 작업은 진도 측정이 어렵습니다. 구역·층·단계별로 분할하세요.")
        g[8] += by_no[8]["items"][:10]
    if not by_no[9]["pass"]:
        g[9].append("Data Date 이후 실적일이나 Data Date 이전 예정일이 있습니다. P6에서 진도를 수정한 뒤 다시 Schedule(F9)하세요.")
    if not by_no[11]["pass"]:
        g[11].append("계획 대비 지연 완료 작업이 많습니다. 지연분석 화면에서 준공일 영향과 원인 작업을 확인하세요.")
    if not by_no[12]["pass"]:
        g[12].append("Data Date부터 준공까지 이어지는 연속 주공정이 없습니다. 준공 마일스톤의 선행 관계를 확인하세요.")
    if not by_no[13]["pass"]:
        g[13].append("CPLI 0.95 미만은 목표 준공 달성이 어렵다는 신호입니다. 주공정 단축 대책(What-if)을 수립하세요.")
    if not by_no[14]["pass"]:
        g[14].append("계획 대비 완료 실적이 부족합니다(BEI). 리스크 화면의 지연 위험 상위 작업을 우선 관리하세요.")
    return dict(g)


# ---------------------------------------------------------------- 지연 원인 (업데이트 비교)
def delay_attribution(base: dict, target: dict) -> dict:
    """두 업데이트 결과(analysis.analyze 출력) 비교로 준공 지연 기여도를 산정.

    방법: 비교 대상 업데이트의 최장 경로를 시간 순으로 따라가며,
    각 액티비티의 종료 지연 중 '선행(구동) 액티비티에서 넘겨받은 지연'을 제외한
    '해당 액티비티가 새로 만든 지연'을 기여분으로 계산한다(Windows 방식의 단순화).
    """
    mb = {a["code"]: a for a in base["activities"]}
    mt = {a["code"]: a for a in target["activities"]}
    by_id_t = {a["id"]: a for a in target["activities"]}

    def slip(code):
        a, b = mb.get(code), mt.get(code)
        if not a or not b or not a["finish"] or not b["finish"]:
            return None
        return (date.fromisoformat(b["finish"]) - date.fromisoformat(a["finish"])).days

    path = sorted([a for a in target["activities"] if a["longest"]], key=lambda a: (a["start"], a["finish"]))
    rows = []
    for a in path:
        s_own = slip(a["code"])
        inherited = None
        for p in a["preds"]:
            pa = by_id_t.get(p["id"])
            if pa and pa["longest"]:
                v = slip(pa["code"])
                if v is not None:
                    inherited = v if inherited is None else max(inherited, v)
        if s_own is None:
            rows.append({"code": a["code"], "name": a["name"], "slip": None, "inherited": inherited,
                         "introduced": None, "note": "이번 업데이트에서 추가된 작업"})
            continue
        intro = s_own - (inherited if inherited is not None else 0)
        before, after = mb[a["code"]], a
        cause = []
        if after["orig_dur"] != before["orig_dur"]:
            cause.append(f"원공기 {before['orig_dur']}→{after['orig_dur']}일")
        if before["status_code"] == "TK_NotStart" and after["status_code"] == "TK_NotStart" and \
                date.fromisoformat(after["start"]) > date.fromisoformat(target["data_date"]) - timedelta(days=0) and \
                date.fromisoformat(before["start"]) < date.fromisoformat(target["data_date"]):
            cause.append("계획 기간 내 미착수(착수 지연)")
        if after["status_code"] == "TK_Active" and after["rem_dur"] > 0:
            exp = before["rem_dur"] - _wd(base["data_date"], target["data_date"])
            if after["rem_dur"] > max(exp, 0):
                cause.append(f"진행 부진(잔여 {before['rem_dur']}→{after['rem_dur']}일)")
        bp = {x["id"] for x in before["preds"]}
        ap = {x["id"] for x in after["preds"]}
        if bp != ap:
            cause.append("선행 관계 변경")
        rows.append({"code": a["code"], "name": a["name"], "slip": s_own, "inherited": inherited,
                     "introduced": intro, "note": ", ".join(cause)})
    total = (date.fromisoformat(target["finish"]) - date.fromisoformat(base["finish"])).days
    contrib = sorted([r for r in rows if r["introduced"]], key=lambda r: -r["introduced"])
    explained = sum(r["introduced"] for r in contrib)
    removed_lp = [a for a in base["activities"] if a["longest"] and a["code"] not in mt]
    return {"finish_slip": total, "path": rows, "top": contrib[:15],
            "explained": explained,
            "data_date_gap_days": (date.fromisoformat(target["data_date"]) - date.fromisoformat(base["data_date"])).days,
            "path_changed": sorted({a["code"] for a in base["activities"] if a["longest"]} ^
                                   {a["code"] for a in target["activities"] if a["longest"]}),
            "removed_from_path": [a["code"] for a in removed_lp]}


def _wd(a: str, b: str) -> int:
    d0, d1 = date.fromisoformat(a), date.fromisoformat(b)
    return sum(1 for i in range((d1 - d0).days) if (d0 + timedelta(days=i)).weekday() < 5)


# ---------------------------------------------------------------- 몬테카를로
DEFAULT_RANGE = (0.9, 1.0, 1.35)  # (낙관, 최빈, 비관) 배수


def monte_carlo(s: Schedule, iterations: int = 300, ranges: dict[str, tuple] | None = None,
                trade_of: dict[str, str] | None = None, seed: int = 7, time_limit: float = 25.0) -> dict:
    rng = random.Random(seed)
    base = {a.id: a.rem_dur for a in s.acts.values()}
    ranges = ranges or {}
    trade_of = trade_of or {}
    finishes, crit = [], defaultdict(int)
    t0 = time.time()
    done = 0
    try:
        for _ in range(iterations):
            for a in s.acts.values():
                d = base[a.id]
                if d > 0 and a.status != "TK_Complete":
                    lo, ml, hi = ranges.get(trade_of.get(a.code, ""), DEFAULT_RANGE)
                    a.rem_dur = max(1, round(d * rng.triangular(lo, hi, ml)))
            s.compute()
            finishes.append(s.finish - 1)
            for a in s.acts.values():
                if a.longest:
                    crit[a.code] += 1
            done += 1
            if time.time() - t0 > time_limit:
                break
    finally:
        for a in s.acts.values():
            a.rem_dur = base[a.id]
        s.compute()
    finishes.sort()

    def pct(p):
        return date.fromordinal(finishes[min(len(finishes) - 1, int(p / 100 * len(finishes)))]).isoformat()

    det = date.fromordinal(s.finish - 1)
    hist = defaultdict(int)
    for f in finishes:
        d = date.fromordinal(f)
        hist[(d - timedelta(days=d.weekday())).isoformat()] += 1
    target = s.must_finish
    prob = (sum(1 for f in finishes if f <= target.toordinal()) / len(finishes)) if target and finishes else None
    names = {a.code: a.name for a in s.acts.values()}
    return {"iterations": done, "deterministic": det.isoformat(),
            "p10": pct(10), "p50": pct(50), "p80": pct(80), "p90": pct(90),
            "must_finish": target.isoformat() if target else None,
            "prob_meet_target": round(prob * 100, 1) if prob is not None else None,
            "histogram": sorted(hist.items()),
            "criticality": sorted([{"code": c, "name": names.get(c, ""), "index": round(100 * n / max(done, 1), 1)}
                                   for c, n in crit.items()], key=lambda x: -x["index"])[:30],
            "assumption": "잔여공기에 삼각분포(낙관 ×0.9, 최빈 ×1.0, 비관 ×1.35)를 적용. 공종별 범위는 벤치마크 실적으로 보정 가능."}


# ---------------------------------------------------------------- 벤치마크 (과거 실적)
def actual_ratios(history: list[dict], trade_map_by_upload: dict[str, dict]) -> dict[str, dict]:
    """완료 액티비티의 (실적 작업일 / 원공기) 비율을 공종별로 집계."""
    samples: dict[str, list[float]] = defaultdict(list)
    seen = set()
    for up in history:
        tm = trade_map_by_upload.get(up["id"], {})
        for a in up["result"]["activities"]:
            if a["status_code"] != "TK_Complete" or a["milestone"] or not a["act_start"] or not a["act_end"] \
                    or a["orig_dur"] <= 0:
                continue
            key = (up["result"]["name"], a["code"])
            if key in seen:
                continue
            seen.add(key)
            actual = _wd(a["act_start"], (date.fromisoformat(a["act_end"]) + timedelta(days=1)).isoformat())
            if actual <= 0:
                continue
            samples[tm.get(a["code"]) or classify_rule(a["name"], a["wbs"])].append(actual / a["orig_dur"])
    out = {}
    for t, xs in samples.items():
        xs.sort()
        out[t] = {"n": len(xs), "mean": round(statistics.mean(xs), 2), "median": round(statistics.median(xs), 2),
                  "p80": round(xs[min(len(xs) - 1, int(0.8 * len(xs)))], 2)}
    return out


def benchmark(current: dict, trade_map: dict[str, str], ratios: dict[str, dict]) -> dict:
    by_trade = defaultdict(lambda: {"count": 0, "rem_days": 0, "orig_days": 0})
    flags = []
    for a in current["activities"]:
        if a["milestone"]:
            continue
        t = trade_map.get(a["code"]) or classify_rule(a["name"], a["wbs"])
        b = by_trade[t]
        b["count"] += 1
        b["orig_days"] += a["orig_dur"]
        if a["status_code"] != "TK_Complete":
            b["rem_days"] += a["rem_dur"]
            r = ratios.get(t)
            if r and r["n"] >= 3 and r["median"] >= 1.15 and a["rem_dur"] >= 5:
                flags.append({"code": a["code"], "name": a["name"], "trade": t, "planned": a["rem_dur"],
                              "expected": round(a["rem_dur"] * r["median"]), "ratio": r["median"], "n": r["n"],
                              "tf": a["tf"], "longest": a["longest"]})
    flags.sort(key=lambda x: (not x["longest"], -(x["expected"] - x["planned"])))
    rows = []
    for t, v in sorted(by_trade.items(), key=lambda x: -x[1]["orig_days"]):
        r = ratios.get(t)
        rows.append({"trade": t, **v, "hist_n": r["n"] if r else 0,
                     "hist_median": r["median"] if r else None, "hist_p80": r["p80"] if r else None})
    return {"trades": rows, "flags": flags[:30]}


# ---------------------------------------------------------------- 지연 위험 점수
def risk_scores(current: dict, history: list[dict], trade_map: dict[str, str],
                ratios: dict[str, dict]) -> list[dict]:
    """설명 가능한 지연 위험 점수(0~100). 이력이 쌓일수록 '추세' 요인 비중이 커진다."""
    prev = sorted([h for h in history if h["result"]["data_date"] < current["data_date"]],
                  key=lambda h: h["result"]["data_date"])
    dd = date.fromisoformat(current["data_date"])
    out = []
    for a in current["activities"]:
        if a["status_code"] == "TK_Complete" or a["milestone"]:
            continue
        score, why = 0.0, []
        if a["longest"]:
            score += 25; why.append("최장경로")
        elif a["tf"] is not None and a["tf"] <= 5:
            score += 18; why.append(f"여유 {a['tf']}일")
        elif a["tf"] is not None and a["tf"] <= 15:
            score += 8; why.append(f"여유 {a['tf']}일")
        if a["tf"] is not None and a["tf"] < 0:
            score += 10; why.append("음수 여유")
        # 착수/완료 예정 임박
        st = date.fromisoformat(a["start"])
        if a["status_code"] == "TK_NotStart" and (st - dd).days <= 30:
            score += 8; why.append("30일 내 착수 예정")
        # 계획 대비 지연
        if a["bl_start"] and a["status_code"] == "TK_NotStart" and date.fromisoformat(a["bl_start"]) < dd:
            score += 12; why.append("계획 착수일 경과")
        if a["bl_finish"] and date.fromisoformat(a["finish"]) > date.fromisoformat(a["bl_finish"]):
            late = (date.fromisoformat(a["finish"]) - date.fromisoformat(a["bl_finish"])).days
            score += min(15, late / 4); why.append(f"계획 대비 {late}일 늦음")
        if a["rem_dur"] > 44:
            score += 6; why.append("장기 작업")
        if a["status_code"] == "TK_Active" and a["orig_dur"] > 0:
            elapsed = max(0, _wd(a["act_start"], current["data_date"])) if a["act_start"] else 0
            exp_pct = min(100, 100 * elapsed / a["orig_dur"])
            if exp_pct - a["pct"] > 20:
                score += 12; why.append(f"진도 부진(경과 {exp_pct:.0f}% 대비 {a['pct']:.0f}%)")
        t = trade_map.get(a["code"]) or classify_rule(a["name"], a["wbs"])
        r = ratios.get(t)
        if r and r["n"] >= 3 and r["median"] > 1.1:
            score += min(10, (r["median"] - 1) * 30); why.append(f"{t} 공종 실적 공기 {r['median']}배")
        # 업데이트 이력 추세
        slips = []
        for h in prev[-4:]:
            ha = next((x for x in h["result"]["activities"] if x["code"] == a["code"]), None)
            if ha and ha["finish"]:
                slips.append((h["result"]["data_date"], ha["finish"]))
        if slips:
            first = date.fromisoformat(slips[0][1])
            moved = (date.fromisoformat(a["finish"]) - first).days
            if moved > 0:
                score += min(20, moved / 2); why.append(f"최근 {len(slips)}회 업데이트 동안 종료 {moved}일 순연")
        out.append({"code": a["code"], "name": a["name"], "trade": t, "status": a["status"], "start": a["start"],
                    "finish": a["finish"], "tf": a["tf"], "longest": a["longest"],
                    "score": round(min(100, score)), "reasons": why})
    out.sort(key=lambda x: -x["score"])
    return out


def lookahead(current: dict, days: int = 30) -> list[dict]:
    dd = date.fromisoformat(current["data_date"])
    end = dd + timedelta(days=days)
    out = [a for a in current["activities"]
           if (a["status_code"] == "TK_NotStart" and date.fromisoformat(a["start"]) <= end)
           or (a["status_code"] == "TK_Active" and date.fromisoformat(a["finish"]) <= end)]
    return sorted(out, key=lambda a: (a["finish"] if a["status_code"] == "TK_Active" else a["start"], a["code"]))
