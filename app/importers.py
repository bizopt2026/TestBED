"""외부 형식 가져오기와 공정표 생성.

- MS Project XML(.xml) → XER 테이블 변환 (defusedxml 로 XXE·엔티티 폭탄 방지)
- 구조화된 액티비티 목록(AI 생성 또는 템플릿) → XER 테이블 생성
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from defusedxml import ElementTree as ET

from .calendar import EXCEL_EPOCH
from .korea import holidays_between
from .xer_parser import write_xer

CAL5 = ("(0||CalendarData()( (0||DaysOfWeek()( (0||1()()) "
        + " ".join(f"(0||{d}()( (0||0(s|08:00|f|12:00)()) (0||1(s|13:00|f|17:00)())))" for d in range(2, 7))
        + " (0||7()()))) (0||Exceptions()( {exc}))))")


def _cal5(d0: date, d1: date) -> str:
    exc = " ".join(f"(0||{i}(d|{(d - EXCEL_EPOCH).days})())" for i, d in enumerate(holidays_between(d0, d1)))
    return CAL5.replace("{exc}", exc)


def _dt(d: date | None, hm: str = "08:00") -> str:
    return f"{d.isoformat()} {hm}" if d else ""


# ---------------------------------------------------------------- 생성기
def build_tables(project: str, start: date, wbs: list[str], acts: list[dict], data_date: date | None = None,
                 must_finish: date | None = None) -> dict:
    """acts: [{code,name,wbs,duration,preds:[{code,type,lag}], milestone: 'start'|'finish'|None,
               status, act_start, act_end, pct}]"""
    pid = "1"
    end_guess = start + timedelta(days=max(365, sum(a.get("duration", 0) for a in acts) * 2))
    tables = {
        "CALENDAR": [{"clndr_id": "1", "default_flag": "Y", "clndr_name": "주5일(법정공휴일)", "day_hr_cnt": "8",
                      "clndr_data": _cal5(start - timedelta(days=30), end_guess)}],
        "PROJECT": [{"proj_id": pid, "proj_short_name": project[:40], "clndr_id": "1",
                     "plan_start_date": _dt(start), "plan_end_date": _dt(must_finish, "17:00"),
                     "last_recalc_date": _dt(data_date or start), "export_flag": "Y"}],
        "PROJWBS": [{"wbs_id": "1", "proj_id": pid, "parent_wbs_id": "", "wbs_short_name": project[:20],
                     "wbs_name": project, "proj_node_flag": "Y"}],
        "TASK": [], "TASKPRED": [], "TASKRSRC": [],
    }
    wbs_ids = {}
    for i, w in enumerate(dict.fromkeys(wbs + [a.get("wbs", "") for a in acts if a.get("wbs")]), start=2):
        wbs_ids[w] = str(i)
        tables["PROJWBS"].append({"wbs_id": str(i), "proj_id": pid, "parent_wbs_id": "1",
                                  "wbs_short_name": w[:20], "wbs_name": w, "proj_node_flag": "N"})
    ids = {}
    for i, a in enumerate(acts, start=1000):
        ids[a["code"]] = str(i)
        dur = 0 if a.get("milestone") else max(1, int(round(float(a.get("duration") or 1))))
        tt = {"start": "TT_Mile", "finish": "TT_FinMile"}.get(a.get("milestone") or "", "TT_Task")
        st = a.get("status") or "TK_NotStart"
        pct = float(a.get("pct") or (100 if st == "TK_Complete" else 0))
        tables["TASK"].append({
            "task_id": str(i), "proj_id": pid, "wbs_id": wbs_ids.get(a.get("wbs", ""), "1"), "clndr_id": "1",
            "task_code": a["code"], "task_name": a["name"][:120], "task_type": tt, "status_code": st,
            "phys_complete_pct": str(pct), "target_drtn_hr_cnt": str(dur * 8),
            "remain_drtn_hr_cnt": str(0 if st == "TK_Complete" else round(dur * 8 * (1 - pct / 100), 1)),
            "act_start_date": _dt(a.get("act_start")), "act_end_date": _dt(a.get("act_end"), "17:00"),
            "target_start_date": "", "target_end_date": "", "cstr_type": "", "cstr_date": ""})
    n = 1
    for a in acts:
        for p in a.get("preds") or []:
            if p.get("code") in ids and p["code"] != a["code"]:
                tables["TASKPRED"].append({"task_pred_id": str(n), "task_id": ids[a["code"]], "pred_task_id": ids[p["code"]],
                                           "proj_id": pid, "pred_proj_id": pid,
                                           "pred_type": "PR_" + (p.get("type") or "FS").upper(),
                                           "lag_hr_cnt": str(float(p.get("lag") or 0) * 8)})
                n += 1
    return tables


def tables_to_xer(tables: dict) -> bytes:
    return write_xer(tables, f"ERMHDR\t19.12\t{date.today().isoformat()}\tProject\tadmin\tadmin\tdbxDatabaseNoName\tProject Management\tKRW").encode("utf-8")


def set_target_from_early(tables: dict) -> dict:
    """생성 직후 계산한 Early 일정을 계획(Target) 날짜로 저장해 베이스라인으로 삼는다."""
    from .schedule import Schedule
    s = Schedule(tables)
    by = {a.id: a for a in s.acts.values()}
    for t in tables["TASK"]:
        a = by.get(t["task_id"])
        if a:
            t["target_start_date"] = _dt(date.fromordinal(a.es))
            t["target_end_date"] = _dt(date.fromordinal(max(a.es, a.ef - 1)), "17:00")
    return tables


# ---------------------------------------------------------------- 템플릿
TEMPLATES = {
    "building": {
        "name": "건축 일반(철근콘크리트/철골)",
        "items": [
            ("M0", "착공", "착공 및 가설", 0, [], "start"), ("G10", "가설 및 현장사무소", "착공 및 가설", 10, ["M0"], None),
            ("G20", "측량 및 부지정지", "토목/기초", 10, ["M0"], None), ("F10", "흙막이 및 터파기", "토목/기초", 20, ["G20"], None),
            ("F20", "파일 시공", "토목/기초", 20, ["F10"], None), ("F30", "기초 철근/거푸집", "토목/기초", 12, ["F20"], None),
            ("F40", "기초 콘크리트 타설·양생", "토목/기초", 7, ["F30"], None),
            ("S10", "지하층 골조", "골조", 30, ["F40"], None), ("S20", "지상층 골조", "골조", 60, ["S10"], None),
            ("S30", "골조 완료", "골조", 0, ["S20"], "finish"),
            ("E10", "외벽·창호", "외장/지붕", 40, [("S20", "SS", 20)], None), ("E20", "지붕·방수", "외장/지붕", 20, ["S30"], None),
            ("I10", "기계설비 배관·덕트", "설비", 50, [("S20", "SS", 25)], None), ("I20", "전기·통신 배선", "설비", 50, [("S20", "SS", 25)], None),
            ("I30", "소방설비", "설비", 30, [("I10", "SS", 15)], None),
            ("N10", "내부 마감", "마감", 50, ["E10", "I10", "I20"], None), ("N20", "조경·부대토목", "부대", 25, ["E20"], None),
            ("C10", "시운전·TAB", "준공", 15, ["N10", "I30"], None), ("C20", "사용승인 검사", "준공", 10, ["C10", "N20"], None),
            ("M9", "준공", "준공", 0, ["C20"], "finish"),
        ],
    },
    "civil": {
        "name": "토목 일반(도로/단지)",
        "items": [
            ("M0", "착공", "착공 및 가설", 0, [], "start"), ("G10", "가설·측량", "착공 및 가설", 15, ["M0"], None),
            ("E10", "벌개제근·토공", "토공", 60, ["G10"], None), ("D10", "배수구조물", "배수", 45, [("E10", "SS", 20)], None),
            ("B10", "구조물(교량/옹벽)", "구조물", 90, [("E10", "SS", 15)], None),
            ("P10", "보조기층·기층", "포장", 30, ["E10", "D10"], None), ("P20", "표층 포장", "포장", 15, ["P10", "B10"], None),
            ("A10", "부대공(차선·안전시설)", "부대", 20, ["P20"], None), ("A20", "준공검사", "준공", 10, ["A10"], None),
            ("M9", "준공", "준공", 0, ["A20"], "finish"),
        ],
    },
}


def from_template(key: str, project: str, start: date, scale: float = 1.0) -> dict:
    t = TEMPLATES[key]
    acts = []
    for code, name, wbs, dur, preds, ms in t["items"]:
        pl = [{"code": p, "type": "FS", "lag": 0} if isinstance(p, str) else {"code": p[0], "type": p[1], "lag": round(p[2] * scale)}
              for p in preds]
        acts.append({"code": code, "name": name, "wbs": wbs, "duration": max(1, round(dur * scale)) if dur else 0,
                     "preds": pl, "milestone": ms})
    tables = build_tables(project, start, [], acts, data_date=start)
    return set_target_from_early(tables)


# ---------------------------------------------------------------- MS Project XML
NS_RE = re.compile(r"^\{.*?\}")


def _strip(tag: str) -> str:
    return NS_RE.sub("", tag)


def _child(el, name):
    for c in el:
        if _strip(c.tag) == name:
            return c
    return None


def _text(el, name, default=""):
    c = _child(el, name)
    return c.text.strip() if c is not None and c.text else default


def _iso_dur_hours(v: str) -> float:
    m = re.match(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", v or "")
    if not m:
        return 0.0
    d, h, mi, s = (float(x) if x else 0.0 for x in m.groups())
    return d * 24 + h + mi / 60 + s / 3600


def _d(v: str) -> date | None:
    try:
        return datetime.fromisoformat(v[:19]).date() if v else None
    except ValueError:
        return None


def msp_xml_to_tables(raw: bytes) -> dict:
    try:
        root = ET.fromstring(raw)
    except Exception as e:  # defusedxml 은 위험한 XML 에서 예외 발생
        raise ValueError(f"MS Project XML을 읽을 수 없습니다: {e.__class__.__name__}")
    if _strip(root.tag) != "Project":
        raise ValueError("MS Project XML 형식이 아닙니다")
    name = _text(root, "Title") or _text(root, "Name") or "MS Project"
    status = _d(_text(root, "StatusDate")) or _d(_text(root, "CurrentDate")) or _d(_text(root, "StartDate")) or date.today()
    start = _d(_text(root, "StartDate")) or status
    must = None  # MS Project 의 FinishDate 는 계산된 종료일이라 목표 준공일로 쓰지 않음
    tasks_el = _child(root, "Tasks")
    if tasks_el is None:
        raise ValueError("Tasks 요소가 없습니다")
    rows = [t for t in tasks_el if _strip(t.tag) == "Task"]
    outline = {}
    acts, wbs_names = [], []
    uid_code = {}
    for t in rows:
        uid = _text(t, "UID")
        if uid == "0" or _text(t, "IsNull") == "1":
            continue
        lvl = int(_text(t, "OutlineLevel", "1") or 1)
        nm = _text(t, "Name") or f"Task {uid}"
        if _text(t, "Summary") == "1":
            outline[lvl] = nm
            wbs_names.append(" > ".join(outline[k] for k in sorted(outline) if k <= lvl))
            for k in [k for k in outline if k > lvl]:
                outline.pop(k)
            continue
        code = _text(t, "WBS") or _text(t, "ID") or uid
        uid_code[uid] = code
        dur_h = _iso_dur_hours(_text(t, "Duration"))
        ms = _text(t, "Milestone") == "1"
        pct = float(_text(t, "PercentComplete", "0") or 0)
        a_s, a_f = _d(_text(t, "ActualStart")), _d(_text(t, "ActualFinish"))
        st = "TK_Complete" if a_f else "TK_Active" if a_s else "TK_NotStart"
        wbs = " > ".join(outline[k] for k in sorted(outline) if k < lvl)
        preds = []
        for pl in t:
            if _strip(pl.tag) != "PredecessorLink":
                continue
            typ = {"0": "FF", "1": "FS", "2": "SF", "3": "SS"}.get(_text(pl, "Type", "1"), "FS")
            lag_tenth_min = float(_text(pl, "LinkLag", "0") or 0)
            preds.append({"uid": _text(pl, "PredecessorUID"), "type": typ, "lag": round(lag_tenth_min / 10 / 60 / 8)})
        acts.append({"uid": uid, "code": code, "name": nm, "wbs": wbs, "duration": 0 if ms else max(1, round(dur_h / 8)),
                     "milestone": ("finish" if acts else "start") if ms else None, "status": st, "pct": pct,
                     "act_start": a_s, "act_end": a_f, "preds": preds,
                     "bl_start": _d(_text(t, "Start")), "bl_finish": _d(_text(t, "Finish"))})
    if not acts:
        raise ValueError("가져올 작업이 없습니다")
    for a in acts:
        a["preds"] = [{"code": uid_code[p["uid"]], "type": p["type"], "lag": p["lag"]} for p in a["preds"] if p["uid"] in uid_code]
    tables = build_tables(name, start, wbs_names, acts, data_date=status, must_finish=must)
    by_code = {t["task_code"]: t for t in tables["TASK"]}
    for a in acts:  # MS Project 의 현재 일정을 계획(Target) 으로 보존
        t = by_code[a["code"]]
        t["target_start_date"] = _dt(a["bl_start"])
        t["target_end_date"] = _dt(a["bl_finish"], "17:00")
    return tables
