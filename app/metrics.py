"""일정 건전성(Schedule Health) 지표 라이브러리와 종합 점수.

DCMA 14-Point, GAO 일정 평가 모범사례, AACE 권고 등에서 널리 쓰이는 점검 항목을
정리했다. 기준값(threshold)과 가중치는 프로젝트별/팀 기본값으로 조정할 수 있다.
"""
from __future__ import annotations

from collections import defaultdict

from .schedule import HARD_CONSTRAINTS, MILESTONES, SUMMARY_TYPES, Schedule

SOFT_CONSTRAINTS = {"CS_MSOA", "CS_MEOA", "CS_MSOB", "CS_MEOB"}

# id, 그룹, 이름, 설명, 비교(le: 값 ≤ 기준, ge: 값 ≥ 기준, info), 기준, 단위, 가중치
METRICS = [
    ("L01", "논리", "선행 누락", "선행 관계가 없는 미완료 작업(시작 마일스톤 제외)", "le", 5, "%", 3),
    ("L02", "논리", "후행 누락", "후행 관계가 없는 미완료 작업(종료 마일스톤 제외)", "le", 5, "%", 3),
    ("L03", "논리", "시작 미구동(Dangling start)", "선행이 FF/SF뿐이라 시작이 논리로 정해지지 않는 작업", "le", 5, "%", 2),
    ("L04", "논리", "종료 미구동(Dangling finish)", "후행이 SS/SF뿐이라 종료가 아무것도 구동하지 않는 작업", "le", 5, "%", 2),
    ("L05", "논리", "중복 관계(Redundant)", "A→B→C 경로가 있는데 A→C FS 관계도 있는 경우", "le", 5, "%", 1),
    ("L06", "논리", "순서 역전 진도", "FS 선행이 끝나지 않았는데 착수한 작업", "le", 0, "개", 2),
    ("L07", "논리", "순환 관계", "Loop", "le", 0, "개", 3),
    ("R01", "관계", "음수 Lag(Lead)", "음수 Lag 관계", "le", 0, "개", 2),
    ("R02", "관계", "양수 Lag", "양수 Lag 관계 비율", "le", 5, "%", 1),
    ("R03", "관계", "FS 외 관계", "SS/FF/SF 관계 비율", "le", 10, "%", 1),
    ("R04", "관계", "SF 관계", "Start-to-Finish 관계 수", "le", 0, "개", 1),
    ("R05", "관계", "과대 Lag", "Lag가 선행 공기의 50%를 넘는 관계", "le", 2, "%", 1),
    ("R06", "관계", "관계 밀도", "작업당 평균 관계 수 (논리망이 충분히 연결되었는지)", "ge", 1.5, "개", 1),
    ("C01", "제약", "강제 제약", "Must/Mandatory/On or Before 제약 작업", "le", 5, "%", 2),
    ("C02", "제약", "약한 제약", "On or After 등 약한 제약 작업", "le", 10, "%", 1),
    ("C03", "제약", "ALAP 제약", "As Late As Possible 작업 (여유 소멸)", "le", 0, "개", 1),
    ("F01", "여유", "음수 여유", "Total Float < 0", "le", 0, "개", 3),
    ("F02", "여유", "과대 여유", "Total Float > 44일", "le", 5, "%", 2),
    ("F03", "여유", "주공정 비율", "TF ≤ 0 미완료 작업 비율 (과다하면 논리·제약 왜곡 의심)", "le", 25, "%", 1),
    ("F04", "여유", "최장경로 연속성", "Data Date부터 준공까지 연속된 최장경로 존재", "ge", 1, "", 3),
    ("F05", "여유", "CPLI", "(주공정 길이 + 주공정 여유) / 주공정 길이", "ge", 0.95, "", 2),
    ("D01", "공기", "장기 작업", "원공기 > 44일 미완료 작업", "le", 5, "%", 2),
    ("D02", "공기", "0일 일반작업", "마일스톤이 아닌데 공기 0일", "le", 0, "개", 1),
    ("D03", "공기", "1일 이하 작업 과다", "원공기 1일 이하 작업 비율 (과도한 세분화)", "le", 20, "%", 0.5),
    ("P01", "진도", "Data Date 이후 실적", "실착수/실완료일이 Data Date 이후", "le", 0, "개", 3),
    ("P02", "진도", "Data Date 이전 예정", "미완료 잔여 작업이 Data Date 이전으로 계획됨", "le", 0, "개", 3),
    ("P03", "진도", "기한 경과 미완료", "계획(Target) 완료일 경과 후 미완료/지연 완료", "le", 5, "%", 2),
    ("P04", "진도", "BEI", "기한 도래 작업 중 완료 비율", "ge", 0.95, "", 2),
    ("P05", "진도", "진행중 0%", "착수했지만 공정률 0%", "le", 0, "개", 1),
    ("P06", "진도", "완료 100% 불일치", "공정률 100%인데 미완료 상태", "le", 0, "개", 1),
    ("S01", "구조", "WBS 미지정", "WBS가 없는 작업", "le", 0, "개", 1),
    ("S02", "구조", "시작/종료 마일스톤", "프로젝트 시작·종료 마일스톤 존재", "ge", 2, "개", 1),
    ("S03", "구조", "자원 미배정", "자원이 배정되지 않은 작업 (참고)", "info", None, "%", 0),
    ("S04", "구조", "중복 액티비티명", "같은 WBS 안에서 이름이 같은 작업", "le", 0, "개", 0.5),
]


def _pct(n, d):
    return round(100.0 * n / d, 1) if d else 0.0


def compute(s: Schedule, result: dict, overrides: dict | None = None) -> dict:
    overrides = overrides or {}
    acts = list(s.acts.values())
    inc = [a for a in acts if a.status != "TK_Complete" and a.task_type not in SUMMARY_TYPES]
    tasks = [a for a in inc if a.task_type not in MILESTONES]
    n_inc, n_task = len(inc) or 1, len(tasks) or 1
    rels = s.rels
    nr = len(rels) or 1
    ddo = s.data_date.toordinal()
    code = lambda xs: [a.code for a in xs][:200]
    rc = lambda xs: [f"{s.acts[r.pred].code}→{s.acts[r.succ].code}" for r in xs][:200]
    vals: dict[str, tuple] = {}

    vals["L01"] = [a for a in inc if not a.preds and a.task_type != "TT_Mile"]
    vals["L02"] = [a for a in inc if not a.succs and a.task_type != "TT_FinMile"]
    vals["L03"] = [a for a in inc if a.preds and all(r.type in ("FF", "SF") for r in a.preds)]
    vals["L04"] = [a for a in inc if a.succs and all(r.type in ("SS", "SF") for r in a.succs)]
    succ_fs = defaultdict(set)
    for r in rels:
        succ_fs[r.pred].add(r.succ)
    redundant = []
    for r in rels:
        if r.type != "FS":
            continue
        for mid in succ_fs[r.pred]:
            if mid != r.succ and r.succ in succ_fs.get(mid, ()):
                redundant.append(r)
                break
    vals["L05"] = redundant
    vals["L06"] = [a for a in acts if a.status != "TK_NotStart" and any(
        r.type == "FS" and s.acts[r.pred].status != "TK_Complete" for r in a.preds)]
    vals["L07"] = [a for a in acts if a.code in set(s.loops)]
    vals["R01"] = [r for r in rels if r.lag < 0]
    vals["R02"] = [r for r in rels if r.lag > 0]
    vals["R03"] = [r for r in rels if r.type != "FS"]
    vals["R04"] = [r for r in rels if r.type == "SF"]
    vals["R05"] = [r for r in rels if r.lag > 0 and s.acts[r.pred].orig_dur and r.lag > 0.5 * s.acts[r.pred].orig_dur]
    vals["C01"] = [a for a in inc if a.cstr_type in HARD_CONSTRAINTS or a.cstr_type2 in HARD_CONSTRAINTS]
    vals["C02"] = [a for a in inc if a.cstr_type in SOFT_CONSTRAINTS or a.cstr_type2 in SOFT_CONSTRAINTS]
    vals["C03"] = [a for a in inc if "CS_ALAP" in (a.cstr_type, a.cstr_type2)]
    vals["F01"] = [a for a in inc if a.tf < 0]
    vals["F02"] = [a for a in inc if a.tf > 44]
    vals["F03"] = [a for a in inc if a.tf <= 0]
    vals["D01"] = [a for a in tasks if a.orig_dur > 44]
    vals["D02"] = [a for a in tasks if a.orig_dur == 0 and a.status == "TK_NotStart"]
    vals["D03"] = [a for a in tasks if 0 < a.orig_dur <= 1]
    vals["P01"] = [a for a in acts if (a.act_start and a.act_start > s.data_date) or (a.act_end and a.act_end > s.data_date)]
    vals["P02"] = [a for a in inc if a.rem_dur > 0 and a.ef <= ddo]
    due = [a for a in acts if a.target_end and a.target_end <= s.data_date]
    vals["P03"] = [a for a in due if not a.act_end or a.act_end > a.target_end]
    vals["P05"] = [a for a in acts if a.status == "TK_Active" and a.pct <= 0]
    vals["P06"] = [a for a in acts if a.status != "TK_Complete" and a.pct >= 100]
    vals["S01"] = [a for a in acts if not a.wbs_id or a.wbs_id not in s.wbs]
    vals["S03"] = [a for a in tasks if not a.has_resource]
    seen, dup = {}, []
    for a in acts:
        k = (a.wbs_id, a.name.strip())
        if k in seen:
            dup.append(a)
        seen[k] = a
    vals["S04"] = dup

    cp_len = s.default_cal.workdays_between(ddo, s.finish)
    cp_tf = s.default_cal.workdays_between(s.finish, s.must_finish.toordinal() + 1) if s.must_finish else 0
    completed_due = [a for a in due if a.status == "TK_Complete"]

    rows = []
    for mid, grp, name, desc, cmp, thr, unit, w in METRICS:
        o = overrides.get(mid, {})
        thr = o.get("threshold", thr)
        w = o.get("weight", w)
        enabled = o.get("enabled", True)
        items, count, total = [], 0, 0
        if mid == "R06":
            value = round(2 * len(rels) / max(len(acts), 1), 2)
        elif mid == "F04":
            value = 1 if any(a.longest for a in inc) else 0
        elif mid == "F05":
            value = round((cp_len + cp_tf) / cp_len, 2) if cp_len > 0 else 1.0
        elif mid == "P04":
            value = round(len(completed_due) / len(due), 2) if due else 1.0
            count, total = len(completed_due), len(due)
        elif mid == "S02":
            value = (1 if any(a.task_type == "TT_Mile" for a in acts) else 0) + \
                    (1 if any(a.task_type == "TT_FinMile" for a in acts) else 0)
        else:
            xs = vals[mid]
            count = len(xs)
            is_rel = mid.startswith("R") or mid == "L05"
            total = nr if is_rel else (n_task if mid in ("D01", "D02", "D03", "S03") else
                                       len(due) or 1 if mid == "P03" else len(acts) if mid in ("P01", "S01", "S04", "L06") else n_inc)
            items = rc(xs) if is_rel else code(xs)
            value = _pct(count, total) if unit == "%" else count
        if cmp == "info" or not enabled:
            ok, score = None, None
        elif cmp == "le":
            ok = value <= thr
            score = 100 if ok else max(0, round(100 * (1 - (value - thr) / max(thr * 2, 1))))
        else:
            ok = value >= thr
            score = 100 if ok else max(0, round(100 * value / thr)) if thr else 0
        rows.append({"id": mid, "group": grp, "name": name, "desc": desc, "cmp": cmp, "threshold": thr, "unit": unit,
                     "weight": w, "enabled": enabled, "value": value, "count": count, "total": total,
                     "pass": ok, "score": score, "items": items})
    scored = [r for r in rows if r["score"] is not None and r["weight"]]
    total_w = sum(r["weight"] for r in scored) or 1
    overall = round(sum(r["score"] * r["weight"] for r in scored) / total_w)
    groups = {}
    for g in dict.fromkeys(r["group"] for r in rows):
        gs = [r for r in scored if r["group"] == g]
        if gs:
            groups[g] = round(sum(r["score"] * r["weight"] for r in gs) / sum(r["weight"] for r in gs))
    grade = "A" if overall >= 90 else "B" if overall >= 75 else "C" if overall >= 60 else "D"
    return {"score": overall, "grade": grade, "groups": groups, "metrics": rows,
            "passed": sum(1 for r in rows if r["pass"]), "evaluated": sum(1 for r in rows if r["pass"] is not None)}


def defaults() -> list[dict]:
    return [{"id": m[0], "group": m[1], "name": m[2], "cmp": m[4], "threshold": m[5], "unit": m[6], "weight": m[7]}
            for m in METRICS]
