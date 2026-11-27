"""XER 테이블 -> 공정 모델 변환 + CPM(Critical Path Method) 계산."""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date, timedelta

from .calendar import WorkCalendar, parse_clndr_data
from .xer_parser import parse_date, parse_float

REL_TYPES = {"PR_FS": "FS", "PR_SS": "SS", "PR_FF": "FF", "PR_SF": "SF"}
STATUS = {"TK_NotStart": "미착수", "TK_Active": "진행중", "TK_Complete": "완료"}
HARD_CONSTRAINTS = {"CS_MSO", "CS_MEO", "CS_MSOB", "CS_MEOB", "CS_MANDSTART", "CS_MANDFIN"}
CONSTRAINT_NAMES = {
    "CS_MSO": "Start On", "CS_MEO": "Finish On", "CS_MSOA": "Start On or After",
    "CS_MSOB": "Start On or Before", "CS_MEOA": "Finish On or After",
    "CS_MEOB": "Finish On or Before", "CS_ALAP": "As Late As Possible",
    "CS_MANDSTART": "Mandatory Start", "CS_MANDFIN": "Mandatory Finish",
}
MILESTONES = {"TT_Mile", "TT_FinMile"}
SUMMARY_TYPES = {"TT_LOE", "TT_WBS"}  # 기간이 선·후행에 의해 결정되는 요약형 작업 (구동하지 않음)


@dataclass
class Activity:
    id: str
    code: str
    name: str
    wbs_id: str
    clndr_id: str
    task_type: str
    status: str
    orig_dur: int
    rem_dur: int
    pct: float
    act_start: date | None
    act_end: date | None
    target_start: date | None
    target_end: date | None
    p6_start: date | None
    p6_end: date | None
    p6_tf_days: float | None
    cstr_type: str
    cstr_date: date | None
    cstr_type2: str
    cstr_date2: date | None
    has_resource: bool = False
    # CPM 결과 (ordinal 시각)
    es: int = 0
    ef: int = 0
    ls: int = 0
    lf: int = 0
    tf: int = 0
    ff: int = 0
    rs: int = 0   # 잔여 작업 조기 시작 (진행중 작업)
    rls: int = 0  # 잔여 작업 만기 시작
    critical: bool = False
    longest: bool = False
    preds: list = field(default_factory=list)
    succs: list = field(default_factory=list)


@dataclass
class Relation:
    pred: str
    succ: str
    type: str
    lag: int  # 작업일
    lag_hr: float


def _d(value: str) -> date | None:
    dt = parse_date(value)
    return dt.date() if dt else None


def _iso(o: int | None) -> str | None:
    return date.fromordinal(o).isoformat() if o is not None else None


class Schedule:
    def __init__(self, tables: dict, proj_id: str | None = None, options: dict | None = None):
        self.options = options or {}
        self.override = bool(self.options.get("progress_override"))
        projects = [p for p in tables.get("PROJECT", []) if p.get("export_flag", "Y") != "N"] \
            or tables.get("PROJECT", [])
        if not projects:
            raise ValueError("PROJECT 테이블이 없습니다")
        self.project = next((p for p in projects if p["proj_id"] == proj_id), projects[0])
        pid = self.project["proj_id"]
        self.proj_id = pid
        self.name = self.project.get("proj_short_name", pid)
        self.warnings: list[str] = []

        tasks = [t for t in tables.get("TASK", []) if t.get("proj_id") == pid]
        if not tasks:
            raise ValueError("TASK(액티비티) 데이터가 없습니다")
        dd = _d(self.project.get("last_recalc_date") or self.project.get("next_data_date")
                or self.project.get("plan_start_date"))
        if dd is None:
            dd = min((_d(t.get("early_start_date")) or date.today()) for t in tasks)
        self.data_date = dd
        self.must_finish = _d(self.project.get("plan_end_date"))  # Must Finish By

        self.wbs = {w["wbs_id"]: w for w in tables.get("PROJWBS", []) if w.get("proj_id") == pid}

        # 캘린더
        span_start = dd - timedelta(days=3650)
        span_end = dd + timedelta(days=365 * 25)
        self.calendars: dict[str, WorkCalendar] = {}
        default_cal = None
        for c in tables.get("CALENDAR", []):
            wdays, exc = parse_clndr_data(c.get("clndr_data", ""))
            cal = WorkCalendar(c["clndr_id"], c.get("clndr_name", ""),
                               parse_float(c.get("day_hr_cnt"), 8.0), wdays, exc,
                               span_start, span_end)
            self.calendars[cal.id] = cal
            if c.get("default_flag") == "Y" and default_cal is None:
                default_cal = cal
        proj_cal = self.project.get("clndr_id")
        if proj_cal in self.calendars:
            default_cal = self.calendars[proj_cal]
        if default_cal is None:
            default_cal = WorkCalendar("__default", "기본(월~금)", 8.0, {0, 1, 2, 3, 4}, {},
                                       span_start, span_end)
            self.calendars[default_cal.id] = default_cal
        self.default_cal = default_cal

        task_ids = {t["task_id"] for t in tasks}
        self.assignments = [r for r in tables.get("TASKRSRC", []) if r.get("task_id") in task_ids]
        self.resources = {r.get("rsrc_id"): r for r in tables.get("RSRC", [])}
        rsrc_tasks = {r.get("task_id") for r in self.assignments}

        self.acts: dict[str, Activity] = {}
        for t in tasks:
            cal = self.calendars.get(t.get("clndr_id"), default_cal)
            a = Activity(
                id=t["task_id"], code=t.get("task_code", t["task_id"]), name=t.get("task_name", ""),
                wbs_id=t.get("wbs_id", ""), clndr_id=cal.id, task_type=t.get("task_type", "TT_Task"),
                status=t.get("status_code", "TK_NotStart"),
                orig_dur=cal.hours_to_days(parse_float(t.get("target_drtn_hr_cnt"))),
                rem_dur=cal.hours_to_days(parse_float(t.get("remain_drtn_hr_cnt"))),
                pct=parse_float(t.get("phys_complete_pct")),
                act_start=_d(t.get("act_start_date")), act_end=_d(t.get("act_end_date")),
                target_start=_d(t.get("target_start_date")), target_end=_d(t.get("target_end_date")),
                p6_start=_d(t.get("early_start_date")),
                p6_end=_d(t.get("early_end_date")),
                p6_tf_days=(parse_float(t["total_float_hr_cnt"]) / cal.day_hours
                            if t.get("total_float_hr_cnt") not in (None, "") else None),
                cstr_type=t.get("cstr_type", ""), cstr_date=_d(t.get("cstr_date")),
                cstr_type2=t.get("cstr_type2", ""), cstr_date2=_d(t.get("cstr_date2")),
                has_resource=t["task_id"] in rsrc_tasks,
            )
            if a.task_type in MILESTONES:
                a.orig_dur = a.rem_dur = 0
            if a.status == "TK_Complete":
                a.rem_dur = 0
            elif a.status == "TK_NotStart":
                a.rem_dur = a.rem_dur if t.get("remain_drtn_hr_cnt") not in (None, "") else a.orig_dur
            self.acts[a.id] = a

        self.rels: list[Relation] = []
        for r in tables.get("TASKPRED", []):
            p, s = r.get("pred_task_id"), r.get("task_id")
            if p in self.acts and s in self.acts:
                lag_hr = parse_float(r.get("lag_hr_cnt"))
                cal = self.calendars[self.acts[p].clndr_id]
                rel = Relation(p, s, REL_TYPES.get(r.get("pred_type"), "FS"),
                               cal.hours_to_days(lag_hr), lag_hr)
                self.rels.append(rel)
                self.acts[p].succs.append(rel)
                self.acts[s].preds.append(rel)
        self.loops: list[str] = []
        self.compute()

    # ------------------------------------------------------------------
    def cal(self, a: Activity) -> WorkCalendar:
        return self.calendars[a.clndr_id]

    def _topo(self) -> list[Activity]:
        indeg = {k: len(a.preds) for k, a in self.acts.items()}
        q = deque(sorted((k for k, v in indeg.items() if v == 0), key=lambda k: self.acts[k].code))
        order = []
        while q:
            k = q.popleft()
            order.append(self.acts[k])
            for r in self.acts[k].succs:
                indeg[r.succ] -= 1
                if indeg[r.succ] == 0:
                    q.append(r.succ)
        if len(order) < len(self.acts):
            stuck = [a for k, a in self.acts.items() if indeg[k] > 0]
            self.loops = [a.code for a in stuck]
            self.warnings.append(f"순환 관계(Loop)가 감지되었습니다: {len(stuck)}개 액티비티 - 관계를 무시하고 계산")
            seen = {a.id for a in order}
            order += [a for a in stuck if a.id not in seen]
        return order

    def compute(self) -> None:
        self.loops = []
        self.warnings = [w for w in self.warnings if "순환" not in w]
        for a in self.acts.values():
            a.longest = a.critical = False
        order = self._topo()
        dd = self.data_date.toordinal()
        loop_ids = {a.id for a in self.acts.values() if a.code in set(self.loops)}

        # ---------- Forward pass ----------
        done: set[str] = set()
        for a in order:
            c = self.cal(a)
            if a.status == "TK_Complete" and a.act_start and a.act_end:
                a.es, a.ef = a.act_start.toordinal(), a.act_end.toordinal() + 1
                if a.ef <= a.es and a.rem_dur == 0 and a.orig_dur == 0:
                    a.ef = a.es = max(a.es, a.ef)
                done.add(a.id)
                continue
            s_cands, f_cands = [dd], []
            for r in a.preds:
                if r.pred not in done or (a.id in loop_ids and r.pred in loop_ids):
                    continue
                p = self.acts[r.pred]
                pc = self.cal(p)
                if p.task_type in SUMMARY_TYPES and a.task_type not in SUMMARY_TYPES:
                    continue  # LOE/WBS 요약 작업은 후행을 구동하지 않음
                if a.status == "TK_Active" and self.override:
                    continue  # Progress Override: 착수된 작업은 선행 논리 무시
                if a.status == "TK_Active" and r.type in ("SS", "SF"):
                    continue  # 이미 착수된 작업의 시작 관계는 충족된 것으로 간주
                if r.type == "FS":
                    s_cands.append(pc.shift(p.ef, r.lag))
                elif r.type == "SS":
                    s_cands.append(pc.shift(p.es, r.lag))
                elif r.type == "FF":
                    f_cands.append(pc.shift(p.ef, r.lag))
                else:  # SF
                    f_cands.append(pc.shift(p.es, r.lag))
            # 제약조건 (Forward)
            ct = {a.cstr_type: a.cstr_date, a.cstr_type2: a.cstr_date2}
            for t, cd in ct.items():
                if not cd or a.status != "TK_NotStart":
                    continue
                o = cd.toordinal()
                if t in ("CS_MSOA", "CS_MSO", "CS_MANDSTART"):
                    s_cands.append(o)
                elif t in ("CS_MEOA", "CS_MEO", "CS_MANDFIN"):
                    f_cands.append(o + 1)
            d = a.rem_dur
            if d == 0:
                x = max(s_cands + f_cands)
                if a.task_type != "TT_FinMile":  # 시작 마일스톤은 작업일 시작으로 정렬
                    x = c.start_of(c.co(x))
                start = x
                fin = x
            else:
                i = c.co(max(s_cands))
                for y in f_cands:  # 종료 시각 y 이후에 끝나야 함
                    i = max(i, c.co(y) - 1 - d + 1)
                start, fin = c.start_of(i), c.end_of(i + d - 1)
            a.rs = start
            if a.status == "TK_Active" and a.act_start:
                a.es = a.act_start.toordinal()
                a.ef = max(fin, a.es)
            else:
                a.es, a.ef = start, fin
            done.add(a.id)

        incomplete = [a for a in self.acts.values() if a.status != "TK_Complete"]
        self.finish = max((a.ef for a in self.acts.values()), default=dd)
        end_target = self.finish
        if self.must_finish:
            end_target = self.must_finish.toordinal() + 1

        # ---------- Backward pass ----------
        done = set()
        for a in reversed(order):
            c = self.cal(a)
            if a.status == "TK_Complete":
                a.ls, a.lf = a.es, a.ef
                done.add(a.id)
                continue
            f_cands, s_cands = [end_target], []
            for r in a.succs:
                if r.succ not in done or (a.id in loop_ids and r.succ in loop_ids):
                    continue
                s = self.acts[r.succ]
                if s.status == "TK_Complete" or (s.task_type in SUMMARY_TYPES and a.task_type not in SUMMARY_TYPES):
                    continue
                if s.status == "TK_Active" and self.override:
                    continue
                pc = c  # lag 은 선행 캘린더 기준
                if r.type == "FS":  # 진행중 후행: 잔여 작업 만기 시작 기준 (Retained Logic)
                    f_cands.append(pc.unshift(s.rls if s.status == "TK_Active" else s.ls, r.lag))
                elif r.type == "SS":
                    if s.status == "TK_Active":
                        continue
                    s_cands.append(pc.unshift(s.ls, r.lag))
                elif r.type == "FF":
                    f_cands.append(pc.unshift(s.lf, r.lag))
                else:
                    s_cands.append(pc.unshift(s.lf, r.lag))
            ct = {a.cstr_type: a.cstr_date, a.cstr_type2: a.cstr_date2}
            for t, cd in ct.items():
                if not cd:
                    continue
                o = cd.toordinal()
                if t in ("CS_MSOB", "CS_MSO", "CS_MANDSTART") and a.status == "TK_NotStart":
                    s_cands.append(o)
                elif t in ("CS_MEOB", "CS_MEO", "CS_MANDFIN"):
                    f_cands.append(o + 1)
            d = a.rem_dur
            if d == 0:
                x = min(f_cands + s_cands)
                if a.task_type != "TT_FinMile":
                    x = c.start_of(c.co(x + 1) - 1)
                a.lf = x
                a.rls = x
                a.ls = x if a.status == "TK_NotStart" else a.es
            else:
                j = c.co(min(f_cands)) - 1
                for z in s_cands:  # 시작 시각 z 이전에 시작해야 함
                    j = min(j, c.co(z) + d - 1)
                a.lf = c.end_of(j)
                a.rls = c.start_of(j - d + 1)
                a.ls = a.rls if a.status == "TK_NotStart" else a.es
            done.add(a.id)

        # ---------- LOE / WBS 요약 작업: 후행 작업으로 종료일 결정 ----------
        for a in self.acts.values():
            if a.task_type not in SUMMARY_TYPES or a.status == "TK_Complete":
                continue
            ends = []
            for r in a.succs:
                s = self.acts[r.succ]
                ends.append(s.ef if r.type in ("FF", "SF") else s.es)
            if ends:
                a.ef = max(a.es, max(ends))
            a.ls, a.lf, a.rls = a.es, a.ef, a.rs

        # ---------- Float ----------
        for a in self.acts.values():
            c = self.cal(a)
            if a.status == "TK_Complete":
                a.tf = a.ff = 0
                continue
            a.tf = c.workdays_between(a.ef, a.lf)
        for a in self.acts.values():
            if a.status == "TK_Complete":
                continue
            c = self.cal(a)
            gaps = []
            for r in a.succs:
                s = self.acts[r.succ]
                if s.status == "TK_Complete":
                    continue
                gaps.append(self._gap(a, s, r))
            a.ff = max(0, min(gaps)) if gaps else max(0, a.tf)
            a.ff = min(a.ff, max(a.tf, 0)) if a.tf >= 0 else 0
            a.critical = a.tf <= 0 and a.task_type not in SUMMARY_TYPES

        # ---------- Longest path ----------
        incomplete = [a for a in incomplete if a.task_type not in SUMMARY_TYPES]
        if incomplete:
            last_ef = max(x.ef for x in incomplete)
            stack = [x for x in incomplete if x.ef == last_ef]
            seen: set[str] = set()
            while stack:
                a = stack.pop()
                if a.id in seen:
                    continue
                seen.add(a.id)
                a.longest = True
                for r in a.preds:
                    p = self.acts[r.pred]
                    if p.status != "TK_Complete" and p.task_type not in SUMMARY_TYPES and self._gap(p, a, r) <= 0:
                        stack.append(p)

    def _gap(self, p: Activity, s: Activity, r: Relation) -> int:
        """관계 여유(작업일): 0 이면 구동(driving) 관계."""
        pc = self.cal(p)
        if s.status == "TK_Active" and self.override:
            return 999999
        if r.type == "FS":
            return pc.workdays_between(pc.shift(p.ef, r.lag), s.rs if s.status == "TK_Active" else s.es)
        if r.type == "SS":
            if s.status == "TK_Active":
                return 999999
            return pc.workdays_between(pc.shift(p.es, r.lag), s.es)
        if r.type == "FF":
            return pc.workdays_between(pc.shift(p.ef, r.lag), s.ef)
        return pc.workdays_between(pc.shift(p.es, r.lag), s.ef)

    # ------------------------------------------------------------------
    def wbs_path(self, wbs_id: str) -> list[str]:
        path, seen = [], set()
        while wbs_id in self.wbs and wbs_id not in seen:
            seen.add(wbs_id)
            w = self.wbs[wbs_id]
            if w.get("proj_node_flag") == "Y":
                break
            path.append(w.get("wbs_name") or w.get("wbs_short_name", ""))
            wbs_id = w.get("parent_wbs_id", "")
        return list(reversed(path))

    def to_dict(self) -> dict:
        acts = []
        def fin(s_: int, f_: int, a_: Activity) -> int:
            if f_ > s_ or (a_.task_type == "TT_FinMile" and f_ == s_):
                return f_ - 1
            return f_

        for a in self.acts.values():
            ms = a.task_type in MILESTONES
            acts.append({
                "id": a.id, "code": a.code, "name": a.name,
                "wbs": " > ".join(self.wbs_path(a.wbs_id)), "wbs_id": a.wbs_id,
                "calendar": self.cal(a).name, "type": a.task_type, "milestone": ms,
                "summary_type": a.task_type in SUMMARY_TYPES,
                "status": STATUS.get(a.status, a.status), "status_code": a.status,
                "orig_dur": a.orig_dur, "rem_dur": a.rem_dur, "pct": a.pct,
                "start": _iso(fin(a.es, a.ef, a) if a.task_type == "TT_FinMile" else a.es),
                "finish": _iso(fin(a.es, a.ef, a)),
                "late_start": _iso(fin(a.ls, a.lf, a) if a.task_type == "TT_FinMile" else a.ls),
                "late_finish": _iso(fin(a.ls, a.lf, a)),
                "act_start": a.act_start.isoformat() if a.act_start else None,
                "act_end": a.act_end.isoformat() if a.act_end else None,
                "bl_start": a.target_start.isoformat() if a.target_start else None,
                "bl_finish": a.target_end.isoformat() if a.target_end else None,
                "p6_start": a.p6_start.isoformat() if a.p6_start else None,
                "p6_finish": a.p6_end.isoformat() if a.p6_end else None,
                "p6_tf": round(a.p6_tf_days, 1) if a.p6_tf_days is not None else None,
                "tf": a.tf if a.status != "TK_Complete" else None,
                "ff": a.ff if a.status != "TK_Complete" else None,
                "critical": a.critical and a.status != "TK_Complete",
                "longest": a.longest,
                "constraint": CONSTRAINT_NAMES.get(a.cstr_type, ""),
                "constraint_date": a.cstr_date.isoformat() if a.cstr_date else None,
                "has_resource": a.has_resource,
                "preds": [{"id": r.pred, "type": r.type, "lag": r.lag} for r in a.preds],
                "succs": [{"id": r.succ, "type": r.type, "lag": r.lag} for r in a.succs],
            })
        acts.sort(key=lambda x: (x["wbs"], x["start"] or "", x["code"]))
        return {
            "proj_id": self.proj_id, "name": self.name,
            "data_date": self.data_date.isoformat(),
            "finish": _iso(self.finish - 1),
            "must_finish": self.must_finish.isoformat() if self.must_finish else None,
            "warnings": self.warnings, "activities": acts,
            "relationship_count": len(self.rels),
            "options": self.options,
        }


def list_projects(tables: dict) -> list[dict]:
    return [{"proj_id": p["proj_id"], "name": p.get("proj_short_name", p["proj_id"])}
            for p in tables.get("PROJECT", [])]
