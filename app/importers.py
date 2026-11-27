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


# ---------------------------------------------------------------- MS Project XML (MSPDI)
NS_RE = re.compile(r"^\{.*?\}")
MSP_CONSTRAINT = {"1": "CS_ALAP", "2": "CS_MSO", "3": "CS_MEO", "4": "CS_MSOA", "5": "CS_MSOB", "6": "CS_MEOA", "7": "CS_MEOB"}
MSP_REL = {"0": "FF", "1": "FS", "2": "SF", "3": "SS"}


def _strip(tag: str) -> str:
    return NS_RE.sub("", tag)


def _child(el, name):
    for c in el:
        if _strip(c.tag) == name:
            return c
    return None


def _children(el, name):
    return [c for c in el if _strip(c.tag) == name] if el is not None else []


def _text(el, name, default=""):
    c = _child(el, name) if el is not None else None
    return c.text.strip() if c is not None and c.text else default


def _iso_dur_hours(v: str) -> float:
    m = re.match(r"-?P(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?", v or "")
    if not m:
        return 0.0
    d, h, mi, s = (float(x) if x else 0.0 for x in m.groups())
    return d * 24 + h + mi / 60 + s / 3600


def _d(v: str) -> date | None:
    try:
        return datetime.fromisoformat(v[:19]).date() if v else None
    except ValueError:
        return None


def _hm(v: str) -> str:
    return (v or "08:00:00")[:5]


def _msp_calendars(root, minutes_per_day: float) -> tuple[dict, str | None]:
    """MSPDI 캘린더 → {uid: (name, clndr_data, day_hours)}. 기준(base) 캘린더 상속을 반영."""
    cals_el = _child(root, "Calendars")
    raw = {}
    for c in _children(cals_el, "Calendar"):
        uid = _text(c, "UID")
        week = {}
        exc = {}
        for wd in _children(_child(c, "WeekDays"), "WeekDay"):
            dt = _text(wd, "DayType")
            working = _text(wd, "DayWorking") == "1"
            times = [(_hm(_text(t, "FromTime")), _hm(_text(t, "ToTime")))
                     for t in _children(_child(wd, "WorkingTimes"), "WorkingTime")]
            if dt == "0":  # 구형 예외일 표기
                tp = _child(wd, "TimePeriod")
                d0, d1 = _d(_text(tp, "FromDate")), _d(_text(tp, "ToDate"))
                if d0 and d1:
                    for k in range(min((d1 - d0).days + 1, 3660)):
                        exc[d0 + timedelta(days=k)] = working
            elif dt.isdigit():
                week[int(dt)] = (working, times)
        for e in _children(_child(c, "Exceptions"), "Exception"):
            tp = _child(e, "TimePeriod")
            d0, d1 = _d(_text(tp, "FromDate")), _d(_text(tp, "ToDate"))
            working = _text(e, "DayWorking") == "1"
            if d0 and d1:
                for k in range(min((d1 - d0).days + 1, 3660)):
                    exc[d0 + timedelta(days=k)] = working
        raw[uid] = {"name": _text(c, "Name") or f"캘린더 {uid}", "base": _text(c, "BaseCalendarUID"),
                    "is_base": _text(c, "IsBaseCalendar") == "1", "week": week, "exc": exc}

    def resolved(uid, depth=0):
        c = raw[uid]
        week = {}
        exc = {}
        if c["base"] in raw and c["base"] != uid and depth < 5:
            bw, be = resolved(c["base"], depth + 1)
            week.update(bw)
            exc.update(be)
        week.update(c["week"])
        exc.update(c["exc"])
        return week, exc

    out = {}
    for uid, c in raw.items():
        week, exc = resolved(uid)
        if not week:
            week = {d: (d not in (1, 7), [("08:00", "12:00"), ("13:00", "17:00")] if d not in (1, 7) else []) for d in range(1, 8)}
        days = []
        for d in range(1, 8):
            working, times = week.get(d, (d not in (1, 7), []))
            if working:
                times = times or [("08:00", "12:00"), ("13:00", "17:00")]
                days.append(f"(0||{d}()( " + " ".join(f"(0||{k}(s|{a}|f|{b})())" for k, (a, b) in enumerate(times)) + "))")
            else:
                days.append(f"(0||{d}()())")
        exc_s = " ".join(f"(0||{k}(d|{(dd - EXCEL_EPOCH).days})({'(0||0(s|08:00|f|17:00)())' if w else ''}))"
                         for k, (dd, w) in enumerate(sorted(exc.items())))
        data = "(0||CalendarData()( (0||DaysOfWeek()( " + " ".join(days) + ")) (0||Exceptions()( " + exc_s + "))))"
        out[uid] = (c["name"], data, minutes_per_day / 60)
    return out, None


def msp_xml_to_tables(raw: bytes, report: dict | None = None) -> dict:
    """MSPDI XML → XER 테이블. report 에 변환 요약·경고를 채운다."""
    report = report if report is not None else {}
    warn = report.setdefault("warnings", [])
    try:
        root = ET.fromstring(raw)
    except Exception as e:  # defusedxml 은 위험한 XML(DTD/엔티티)에서 예외 발생
        raise ValueError(f"MS Project XML을 읽을 수 없습니다: {e.__class__.__name__}")
    if _strip(root.tag) != "Project":
        raise ValueError("MS Project XML(MSPDI) 형식이 아닙니다")
    name = _text(root, "Title") or re.sub(r"\.xml$", "", _text(root, "Name"), flags=re.I) or "MS Project"
    mpd = float(_text(root, "MinutesPerDay", "480") or 480)
    hpd = mpd / 60
    status = _d(_text(root, "StatusDate")) or _d(_text(root, "CurrentDate")) or _d(_text(root, "StartDate")) or date.today()
    start = _d(_text(root, "StartDate")) or status
    cals, _ = _msp_calendars(root, mpd)
    proj_cal = _text(root, "CalendarUID")
    tasks_el = _child(root, "Tasks")
    if tasks_el is None:
        raise ValueError("Tasks 요소가 없습니다")

    pid = "1"
    tables = {"CALENDAR": [], "PROJECT": [], "PROJWBS": [], "TASK": [], "TASKPRED": [], "TASKRSRC": [], "RSRC": []}
    if not cals:
        cals = {"1": ("주5일", _cal5(start - timedelta(days=30), start + timedelta(days=1500)), 8.0)}
        proj_cal = "1"
    if proj_cal not in cals:
        proj_cal = next(iter(cals))
    for uid, (cname, data, dh) in cals.items():
        tables["CALENDAR"].append({"clndr_id": uid, "default_flag": "Y" if uid == proj_cal else "N",
                                   "clndr_name": cname, "day_hr_cnt": str(dh), "clndr_data": data})
    tables["PROJECT"].append({"proj_id": pid, "proj_short_name": name[:60], "clndr_id": proj_cal,
                              "plan_start_date": _dt(start), "plan_end_date": "", "last_recalc_date": _dt(status),
                              "export_flag": "Y"})
    tables["PROJWBS"].append({"wbs_id": "W0", "proj_id": pid, "parent_wbs_id": "", "wbs_short_name": name[:20],
                              "wbs_name": name, "proj_node_flag": "Y"})

    rows = [t for t in tasks_el if _strip(t.tag) == "Task"]
    # 요약 작업(WBS)은 OutlineNumber 로 부모를 찾는다 (파일 안 순서가 개요 순서가 아닐 수 있음)
    outline_wbs = {_text(t, "OutlineNumber"): f"W{_text(t, 'UID')}" for t in rows
                   if _text(t, "Summary") == "1" and _text(t, "OutlineNumber") and _text(t, "UID") not in ("", "0")}

    def parent_of(t):
        on = _text(t, "OutlineNumber")
        if not on or not outline_wbs:
            return None
        parts = on.split(".")
        for k in range(len(parts) - 1, 0, -1):
            w = outline_wbs.get(".".join(parts[:k]))
            if w:
                return w
        return "W0"
    stack: dict[int, str] = {}   # outline level -> wbs_id (OutlineNumber 가 없을 때 사용)
    uid_task: dict[str, dict] = {}
    codes: set[str] = set()
    skipped = {"inactive": 0, "external": 0, "null": 0}
    pct_lag = elapsed_lag = 0
    deadline_cnt = 0
    for t in rows:
        uid = _text(t, "UID")
        if uid in ("", "0") or _text(t, "IsNull") == "1":
            skipped["null"] += uid not in ("", "0")
            continue
        if _text(t, "Active", "1") == "0":
            skipped["inactive"] += 1
            continue
        if _text(t, "ExternalTask") == "1" or _text(t, "IsSubprojectReadOnly") == "1":
            skipped["external"] += 1
            continue
        lvl = int(_text(t, "OutlineLevel", "1") or 1)
        nm = _text(t, "Name") or f"Task {uid}"
        for k in [k for k in stack if k >= lvl]:
            stack.pop(k)
        parent = parent_of(t) or stack.get(max([k for k in stack if k < lvl], default=-1), "W0")
        if _text(t, "Summary") == "1":
            wid = f"W{uid}"
            tables["PROJWBS"].append({"wbs_id": wid, "proj_id": pid, "parent_wbs_id": parent,
                                      "wbs_short_name": (_text(t, "WBS") or uid)[:20], "wbs_name": nm, "proj_node_flag": "N"})
            stack[lvl] = wid
            continue
        code = (_text(t, "WBS") or _text(t, "ID") or uid)[:40]
        if code in codes:
            code = f"{code}-{uid}"
        codes.add(code)
        cal_uid = _text(t, "CalendarUID")
        cal_uid = cal_uid if cal_uid in cals else proj_cal
        dh = cals[cal_uid][2] or hpd
        dur_h = _iso_dur_hours(_text(t, "Duration"))
        rem_txt = _text(t, "RemainingDuration")
        ms = _text(t, "Milestone") == "1"
        pct = float(_text(t, "PercentComplete", "0") or 0)
        a_s, a_f = _d(_text(t, "ActualStart")), _d(_text(t, "ActualFinish"))
        st = "TK_Complete" if a_f or pct >= 100 else "TK_Active" if a_s or pct > 0 else "TK_NotStart"
        if st == "TK_Complete" and not a_f:
            a_f = _d(_text(t, "Finish"))
        if st != "TK_NotStart" and not a_s:
            a_s = _d(_text(t, "Start"))
        rem_h = 0 if st == "TK_Complete" else (_iso_dur_hours(rem_txt) if rem_txt else dur_h * (1 - pct / 100))
        bl = next((b for b in _children(t, "Baseline") if _text(b, "Number", "0") == "0"), None)
        bl_s = _d(_text(bl, "Start")) if bl is not None else None
        bl_f = _d(_text(bl, "Finish")) if bl is not None else None
        ctype = MSP_CONSTRAINT.get(_text(t, "ConstraintType", "0"), "")
        cdate = _d(_text(t, "ConstraintDate")) if ctype and ctype != "CS_ALAP" else None
        deadline = _d(_text(t, "Deadline"))
        cstr2 = ""
        if deadline:
            cstr2 = "CS_MEOB"
            deadline_cnt += 1
        task = {"task_id": uid, "proj_id": pid, "wbs_id": stack.get(max(stack, default=-1), "W0") if stack else "W0",
                "clndr_id": cal_uid, "task_code": code, "task_name": nm[:120],
                "task_type": "TT_Task", "status_code": st, "phys_complete_pct": str(pct),
                "target_drtn_hr_cnt": str(0 if ms else dur_h), "remain_drtn_hr_cnt": str(0 if ms else max(0.0, rem_h)),
                "act_start_date": _dt(a_s), "act_end_date": _dt(a_f, "17:00"),
                "target_start_date": _dt(bl_s), "target_end_date": _dt(bl_f, "17:00"),
                "early_start_date": "", "early_end_date": "",
                "cstr_type": ctype, "cstr_date": _dt(cdate), "cstr_type2": cstr2, "cstr_date2": _dt(deadline, "17:00"),
                "_ms": ms, "_preds": []}
        # 부모 WBS: 현재 레벨보다 낮은 레벨의 가장 가까운 요약 작업
        task["wbs_id"] = parent
        for pl in _children(t, "PredecessorLink"):
            typ = MSP_REL.get(_text(pl, "Type", "1"), "FS")
            lag_val = float(_text(pl, "LinkLag", "0") or 0)
            fmt = _text(pl, "LagFormat", "7")
            if fmt in ("19", "20", "51", "52"):     # % 지연: 선행 공기 대비 비율 → 나중에 일수로 환산
                lag = ("pct", lag_val / 10.0)
                pct_lag += 1
            elif fmt in ("8", "10", "12", "4", "6"):  # 경과(elapsed) 시간 → 근사 환산(작업일 ≈ 달력일 × 5/7)
                lag = ("hr", lag_val / 10 / 60 / 24 * 5 / 7 * hpd)
                elapsed_lag += 1
            else:
                lag = ("hr", lag_val / 10 / 60)
            task["_preds"].append((_text(pl, "PredecessorUID"), typ, lag))
        uid_task[uid] = task
        tables["TASK"].append(task)
    if not tables["TASK"]:
        raise ValueError("가져올 작업이 없습니다")
    succ_count: dict[str, int] = {}
    n = 1
    for t in tables["TASK"]:
        for puid, typ, (kind, v) in t["_preds"]:
            p = uid_task.get(puid)
            if not p:
                continue
            hrs = v if kind == "hr" else float(p["target_drtn_hr_cnt"]) * v / 100
            tables["TASKPRED"].append({"task_pred_id": str(n), "task_id": t["task_id"], "pred_task_id": puid, "proj_id": pid,
                                       "pred_proj_id": pid, "pred_type": "PR_" + typ, "lag_hr_cnt": str(round(hrs, 2))})
            succ_count[puid] = succ_count.get(puid, 0) + 1
            n += 1
    for t in tables["TASK"]:
        if t.pop("_ms"):
            t["task_type"] = "TT_Mile" if not t["_preds"] and succ_count.get(t["task_id"]) else "TT_FinMile"
        t.pop("_preds")
    # 자원·비용 (MSPDI 비용 단위는 1/100)
    for r in _children(_child(root, "Resources"), "Resource"):
        ruid = _text(r, "UID")
        if ruid in ("", "0"):
            continue
        tables["RSRC"].append({"rsrc_id": ruid, "rsrc_short_name": (_text(r, "Initials") or ruid)[:20],
                               "rsrc_name": _text(r, "Name") or f"자원 {ruid}",
                               "rsrc_type": {"0": "RT_Mat", "1": "RT_Labor", "2": "RT_Equip"}.get(_text(r, "Type", "1"), "RT_Labor")})
    k = 1
    for a in _children(_child(root, "Assignments"), "Assignment"):
        tuid, ruid = _text(a, "TaskUID"), _text(a, "ResourceUID")
        if tuid not in uid_task or ruid in ("", "-65535"):
            continue
        cost = float(_text(a, "Cost", "0") or 0) / 100
        act = float(_text(a, "ActualCost", "0") or 0) / 100
        rem_c = float(_text(a, "RemainingCost", "") or (cost - act) * 100) / 100 if _text(a, "RemainingCost") else max(0.0, cost - act)
        bl = next((b for b in _children(a, "Baseline") if _text(b, "Number", "0") == "0"), None)
        bl_cost = float(_text(bl, "Cost", "0") or 0) / 100 if bl is not None else 0.0
        tables["TASKRSRC"].append({"taskrsrc_id": str(k), "task_id": tuid, "proj_id": pid, "rsrc_id": ruid,
                                   "target_cost": str(bl_cost or cost), "act_reg_cost": str(act), "act_ot_cost": "0",
                                   "remain_cost": str(rem_c), "target_qty": str(_iso_dur_hours(_text(a, "Work"))),
                                   "remain_qty": str(_iso_dur_hours(_text(a, "RemainingWork")))})
        k += 1
    if not tables["TASKRSRC"]:
        tables.pop("TASKRSRC")
    if not tables["RSRC"]:
        tables.pop("RSRC")
    no_bl = sum(1 for t in tables["TASK"] if not t["target_end_date"])
    report.update({"activities": len(tables["TASK"]), "relationships": len(tables["TASKPRED"]),
                   "wbs": len(tables["PROJWBS"]) - 1, "calendars": len(tables["CALENDAR"]),
                   "assignments": len(tables.get("TASKRSRC", [])), "status_date": status.isoformat(),
                   "baseline_missing": no_bl})
    if no_bl:
        warn.append(f"베이스라인(Baseline0)이 없는 작업 {no_bl}개: 계획 대비 분석에서 제외됩니다. MS Project에서 '기준 계획 설정' 후 저장하면 반영됩니다.")
    if pct_lag:
        warn.append(f"% 단위 Lag {pct_lag}건을 선행 작업 공기 기준 일수로 환산했습니다.")
    if elapsed_lag:
        warn.append(f"경과 시간(elapsed) Lag {elapsed_lag}건을 작업일로 근사 환산했습니다(달력일 × 5/7).")
    if deadline_cnt:
        warn.append(f"Deadline(기한) {deadline_cnt}건을 'Finish On or Before' 보조 제약으로 가져왔습니다.")
    if any(skipped.values()):
        warn.append(f"제외한 작업: 비활성 {skipped['inactive']}개, 외부/하위 프로젝트 {skipped['external']}개.")
    if not _text(root, "StatusDate"):
        warn.append("상태 날짜(Status Date)가 없어 현재 날짜/시작일을 Data Date로 사용했습니다.")
    return tables
