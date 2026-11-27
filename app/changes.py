"""공정표 변경안(시나리오) 적용: What-if, 관계 추천 반영, 진도 입력 반영 공통 사용.

변경 op 형식 (액티비티는 Activity ID=task_code 로 지정):
  {"op": "set_duration", "code": "A1000", "days": 10}            잔여공기(미착수면 원공기 포함) 변경
  {"op": "set_progress", "code": "A1000", "act_start": "2026-03-02",
       "act_end": null, "pct": 40, "remaining_days": 6}           진도 입력
  {"op": "add_rel", "pred": "A1", "succ": "A2", "type": "FS", "lag": 0}
  {"op": "remove_rel", "pred": "A1", "succ": "A2"}
  {"op": "set_lag", "pred": "A1", "succ": "A2", "lag": 3}
  {"op": "set_data_date", "date": "2026-04-01"}
"""
from __future__ import annotations

import copy

from .xer_parser import parse_float

REL = {"FS": "PR_FS", "SS": "PR_SS", "FF": "PR_FF", "SF": "PR_SF"}


class ChangeError(ValueError):
    pass


def _day_hours(tables: dict, task: dict) -> float:
    for c in tables.get("CALENDAR", []):
        if c.get("clndr_id") == task.get("clndr_id"):
            h = parse_float(c.get("day_hr_cnt"), 8.0)
            return h if h > 0 else 8.0
    return 8.0


def apply_changes(tables: dict, proj_id: str, changes: list[dict]) -> tuple[dict, list[str]]:
    """변경안을 적용한 테이블 사본과 적용 로그를 반환."""
    t = copy.deepcopy(tables)
    tasks = [x for x in t.get("TASK", []) if x.get("proj_id") == proj_id]
    by_code = {x.get("task_code"): x for x in tasks}
    preds = t.setdefault("TASKPRED", [])
    log: list[str] = []

    def task(code):
        if code not in by_code:
            raise ChangeError(f"존재하지 않는 액티비티 ID: {code}")
        return by_code[code]

    def find_rel(p, s):
        tp, ts = task(p)["task_id"], task(s)["task_id"]
        return [r for r in preds if r.get("pred_task_id") == tp and r.get("task_id") == ts]

    for ch in changes or []:
        op = ch.get("op")
        if op == "set_duration":
            x = task(ch["code"])
            hrs = float(ch["days"]) * _day_hours(t, x)
            if x.get("status_code") == "TK_Complete":
                raise ChangeError(f"{ch['code']}는 완료된 작업이라 공기를 바꿀 수 없습니다")
            if x.get("status_code") != "TK_Active":
                x["target_drtn_hr_cnt"] = str(hrs)
            x["remain_drtn_hr_cnt"] = str(hrs)
            log.append(f"{ch['code']} 잔여공기 → {ch['days']}일")
        elif op == "set_progress":
            x = task(ch["code"])
            h = _day_hours(t, x)
            if ch.get("act_start"):
                x["act_start_date"] = f"{ch['act_start']} 08:00"
                x["status_code"] = "TK_Active"
            if ch.get("pct") is not None:
                x["phys_complete_pct"] = str(ch["pct"])
            if ch.get("remaining_days") is not None:
                x["remain_drtn_hr_cnt"] = str(float(ch["remaining_days"]) * h)
            elif ch.get("pct") is not None and x.get("status_code") == "TK_Active":
                orig = parse_float(x.get("target_drtn_hr_cnt"))
                x["remain_drtn_hr_cnt"] = str(round(orig * (1 - float(ch["pct"]) / 100), 2))
            if ch.get("act_end"):
                if not x.get("act_start_date"):
                    x["act_start_date"] = f"{ch['act_end']} 08:00"
                x["act_end_date"] = f"{ch['act_end']} 17:00"
                x["status_code"] = "TK_Complete"
                x["phys_complete_pct"] = "100"
                x["remain_drtn_hr_cnt"] = "0"
            log.append(f"{ch['code']} 진도 반영 ({', '.join(k + '=' + str(v) for k, v in ch.items() if k not in ('op', 'code') and v is not None)})")
        elif op == "add_rel":
            p, s = task(ch["pred"]), task(ch["succ"])
            if find_rel(ch["pred"], ch["succ"]):
                raise ChangeError(f"이미 관계가 있습니다: {ch['pred']} → {ch['succ']}")
            typ = REL.get((ch.get("type") or "FS").upper())
            if not typ:
                raise ChangeError(f"관계 유형 오류: {ch.get('type')}")
            new_id = max([int(r.get("task_pred_id") or 0) for r in preds if str(r.get("task_pred_id", "")).isdigit()] + [900000]) + 1
            preds.append({"task_pred_id": str(new_id), "task_id": s["task_id"], "pred_task_id": p["task_id"],
                          "proj_id": proj_id, "pred_proj_id": proj_id, "pred_type": typ,
                          "lag_hr_cnt": str(float(ch.get("lag") or 0) * _day_hours(t, p))})
            log.append(f"관계 추가 {ch['pred']} → {ch['succ']} ({typ[3:]}{'+' + str(ch.get('lag')) if ch.get('lag') else ''})")
        elif op == "remove_rel":
            found = find_rel(ch["pred"], ch["succ"])
            if not found:
                raise ChangeError(f"관계가 없습니다: {ch['pred']} → {ch['succ']}")
            for r in found:
                preds.remove(r)
            log.append(f"관계 삭제 {ch['pred']} → {ch['succ']}")
        elif op == "set_lag":
            found = find_rel(ch["pred"], ch["succ"])
            if not found:
                raise ChangeError(f"관계가 없습니다: {ch['pred']} → {ch['succ']}")
            for r in found:
                r["lag_hr_cnt"] = str(float(ch["lag"]) * _day_hours(t, task(ch["pred"])))
            log.append(f"Lag 변경 {ch['pred']} → {ch['succ']} = {ch['lag']}일")
        elif op == "add_holidays":
            from datetime import date as _date

            from .korea import add_holidays_to_clndr
            days = [_date.fromisoformat(d) for d in ch.get("dates") or []]
            targets = ch.get("clndr_ids") or []
            n = 0
            for c in t.get("CALENDAR", []):
                if not targets or c.get("clndr_id") in targets:
                    new = add_holidays_to_clndr(c.get("clndr_data", ""), days)
                    n += new != c.get("clndr_data", "")
                    c["clndr_data"] = new
            log.append(f"캘린더 {n}개에 공휴일 {len(days)}일 반영")
        elif op == "set_data_date":
            for pr in t.get("PROJECT", []):
                if pr.get("proj_id") == proj_id:
                    pr["last_recalc_date"] = f"{ch['date']} 08:00"
            log.append(f"Data Date → {ch['date']}")
        else:
            raise ChangeError(f"알 수 없는 변경 유형: {op}")
    return t, log
