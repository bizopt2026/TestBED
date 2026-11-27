"""엑셀 리포트 양식에서 쓸 수 있는 필드(자리표시자) 정의와 값 계산.

양식 작성법
  - 값:   {{project.name}}  {{project.finish}}  {{evm.spi}}
  - 표:   한 행에 {{critical.code}} {{critical.name}} ... 를 넣으면 항목 수만큼 아래로 채운다
          {{critical[10].code}} 처럼 개수 제한 가능, {{critical.#}} 는 순번
  - 서식: {{project.finish|date:%Y.%m.%d}}  {{evm.spi|num:2}}  {{x|default:-}}  {{x|pct}}
값은 필요한 것만 계산한다(양식에 없는 리스크 시뮬레이션 등은 실행하지 않음).
"""
from __future__ import annotations

from datetime import date, timedelta

from . import evm as _evm
from . import insights, services, storage

# 키: (설명, 예시)
SCALARS = {
    "project.name": ("프로젝트명", "물류센터 신축공사"),
    "project.data_date": ("Data Date(기준일)", "2026-04-01"),
    "project.start": ("착공(최초 시작)일", "2026-01-05"),
    "project.finish": ("예상 준공일(엔진 계산)", "2026-09-25"),
    "project.must_finish": ("목표 준공일(Must Finish)", "2026-09-30"),
    "project.margin_days": ("목표 대비 여유일(음수=지연)", 5),
    "project.progress_pct": ("공정률 %(원공기 가중)", 14.1),
    "project.activities": ("액티비티 수", 25),
    "project.completed": ("완료 작업 수", 3),
    "project.in_progress": ("진행 작업 수", 3),
    "project.not_started": ("미착수 작업 수", 19),
    "project.relationships": ("관계 수", 29),
    "project.remaining_workdays": ("잔여 작업일", 127),
    "project.longest_count": ("최장경로 작업 수", 10),
    "project.negative_float_count": ("음수 여유 작업 수", 0),
    "project.calc_mode": ("계산 방식", "Retained Logic"),
    "report.date": ("보고서 작성일", "2026-11-27"),
    "report.author": ("작성자", "홍길동"),
    "report.month": ("보고 기준 월", "2026년 4월"),
    "prev.data_date": ("직전 업데이트 Data Date", "2026-03-02"),
    "prev.finish": ("직전 업데이트 예상 준공", "2026-08-26"),
    "prev.finish_slip": ("직전 대비 준공 변동일(+지연)", 30),
    "prev.progress_pct": ("직전 업데이트 공정률 %", 10.2),
    "baseline.finish": ("베이스라인(계획) 준공일", "2026-06-29"),
    "baseline.variance_days": ("베이스라인 대비 준공 편차일", 88),
    "baseline.late_count": ("베이스라인 대비 지연 작업 수", 21),
    "health.score": ("건전성 점수(0~100)", 84),
    "health.grade": ("건전성 등급(A~D)", "B"),
    "dcma.pass": ("DCMA 통과 항목 수(/14)", 7),
    "evm.bac": ("총예산 BAC", 452000000), "evm.pv": ("계획가치 PV", 167000000), "evm.ev": ("획득가치 EV", 63000000),
    "evm.ac": ("실투입비 AC", 68250000), "evm.eac": ("준공시 예상원가 EAC", 457250000),
    "evm.spi": ("SPI", 0.38), "evm.cpi": ("CPI", 0.92), "evm.sv": ("일정 차이 SV", -104000000), "evm.cv": ("원가 차이 CV", -5250000),
    "risk.open_count": ("열린 리스크 수", 2),
    "risk.p50": ("시뮬레이션 P50 준공일", "2026-10-20"), "risk.p80": ("시뮬레이션 P80 준공일", "2026-10-30"),
    "risk.p90": ("시뮬레이션 P90 준공일", "2026-11-05"), "risk.prob_target": ("목표 준공 달성 확률 %", 3.8),
    "ppc.last": ("최근 주간 PPC %", 75), "ppc.avg4": ("최근 4주 평균 PPC %", 78),
    "constraint.open_count": ("미해결 제약 수", 3), "constraint.overdue_count": ("기한 지난 제약 수", 1),
    "summary.headline": ("핵심 메시지(보고서 문장)", "예상 준공일 2026-09-25(전월 대비 +30일)"),
    "summary.text": ("요약 문단", "Data Date 2026-04-01 기준 공정률 14.1% ..."),
    "summary.delay_causes": ("지연 원인 문단", "- A2000 철골 제작: +33일"),
    "summary.next_month": ("향후 1개월 문단", "- A1050 기초 철근 착수 04-10"),
    "summary.risks_actions": ("리스크·대책 문단", "- ..."),
}

ACT_FIELDS = {"code": "Activity ID", "name": "작업명", "wbs": "WBS", "trade": "공종", "status": "상태", "orig_dur": "원공기(일)",
              "rem_dur": "잔여공기(일)", "pct": "공정률 %", "start": "시작(예정/실적)", "finish": "종료(예정/실적)",
              "late_finish": "Late Finish", "tf": "Total Float", "ff": "Free Float", "bl_start": "계획 시작", "bl_finish": "계획 종료",
              "finish_var": "계획 대비 종료 편차(일, +지연)", "act_start": "실착수일", "act_end": "실완료일",
              "critical": "최장경로 여부(Y/N)", "calendar": "캘린더", "constraint": "제약조건"}

LISTS = {
    "activities": ("전체 액티비티", ACT_FIELDS),
    "open": ("미완료 액티비티", ACT_FIELDS),
    "critical": ("최장경로(주공정) 미완료 작업, 시작일 순", ACT_FIELDS),
    "near_critical": ("준주공정(여유 1~10일)", ACT_FIELDS),
    "milestones": ("마일스톤", ACT_FIELDS),
    "lookahead": ("향후 30일 착수·완료 예정 작업", ACT_FIELDS),
    "late": ("계획(베이스라인) 대비 지연 작업, 지연 큰 순", ACT_FIELDS),
    "completed_period": ("직전 업데이트 이후 완료된 작업", ACT_FIELDS),
    "started_period": ("직전 업데이트 이후 착수한 작업", ACT_FIELDS),
    "wbs": ("WBS(최상위) 요약", {"name": "WBS", "activities": "작업 수", "progress_pct": "공정률 %", "start": "시작",
                                "finish": "종료", "bl_finish": "계획 종료", "finish_var": "편차(일)", "critical": "최장경로 작업 수"}),
    "delay_top": ("지연 기여 작업(직전 업데이트 대비)", {"code": "ID", "name": "작업명", "slip": "종료 순연(일)",
                                                       "introduced": "새로 발생한 지연(일)", "note": "추정 원인"}),
    "changes": ("업데이트 변경 로그", {"category": "구분", "code": "ID", "name": "대상", "before": "변경 전", "after": "변경 후", "note": "비고"}),
    "risks": ("리스크 레지스터", {"title": "리스크", "category": "분류", "codes": "영향 작업", "prob": "확률 %", "impact_ml": "영향(최빈, 일)",
                                 "exposure_days": "노출도(일)", "owner": "담당", "mitigation": "대응", "status": "상태"}),
    "constraints": ("미해결 제약", {"code": "ID", "type": "유형", "desc": "내용", "owner": "담당", "due": "기한", "status": "상태"}),
    "ppc_weeks": ("주간 PPC", {"week": "주 시작일", "planned": "약속", "done": "완료", "ppc": "PPC %"}),
    "dcma": ("DCMA 14 결과", {"no": "번호", "name": "항목", "value": "결과", "threshold": "기준", "result": "판정"}),
    "health_failed": ("건전성 미달 지표", {"id": "ID", "group": "그룹", "name": "항목", "value": "결과", "threshold": "기준", "score": "점수"}),
    "trend": ("업데이트별 추세", {"data_date": "Data Date", "finish": "예상 준공", "finish_change": "변동(일)", "progress": "공정률 %",
                                 "longest": "최장경로 작업", "negative_float": "음수여유", "health": "건전성"}),
    "trades": ("공종별 요약", {"trade": "공종", "count": "작업 수", "done": "완료", "critical": "최장경로", "rem_days": "잔여 작업일 합"}),
    "scurve": ("S-Curve 데이터(누적 공정률 %)", {"date": "날짜", "baseline": "계획", "early": "Early", "late": "Late"}),
    "evm_history": ("업데이트별 EVM", {"date": "Data Date", "pv": "PV", "ev": "EV", "ac": "AC", "spi": "SPI", "cpi": "CPI"}),
}


def _dd(a: str | None, b: str | None):
    return (date.fromisoformat(a) - date.fromisoformat(b)).days if a and b else None


class Context:
    """양식이 요청한 값만 계산하는 지연 평가 컨텍스트."""

    def __init__(self, uid: str, user: str = "", use_ai: bool = False, base_uid: str | None = None):
        self.uid, self.user, self.use_ai, self.base = uid, user, use_ai, base_uid
        self.r = services.result(uid)
        self._c: dict = {}

    def _memo(self, key, fn):
        if key not in self._c:
            self._c[key] = fn()
        return self._c[key]

    # ---- 공통 계산
    def tmap(self):
        return self._memo("tmap", lambda: services.trade_map(self.uid))

    def prev(self):
        def get():
            if self.base:
                try:
                    return {"id": self.base, "result": services.result(self.base)}
                except KeyError:
                    pass
            return services.previous_upload(self.uid)
        return self._memo("prev", get)

    def evm(self):
        return self._memo("evm", lambda: services.evm(self.uid, None))

    def health(self):
        return self._memo("health", lambda: services.health(self.uid))

    def sim(self):
        return self._memo("sim", lambda: services.simulate(self.uid, 500))

    def report(self):
        return self._memo("report", lambda: services.report(self.uid, None, self.use_ai, self.user)["sections"])

    def act(self, a: dict) -> dict:
        out = {k: a.get(k) for k in ("code", "name", "wbs", "status", "orig_dur", "rem_dur", "pct", "late_finish",
                                     "tf", "ff", "bl_start", "bl_finish", "act_start", "act_end", "calendar", "constraint")}
        out["start"] = a["act_start"] or a["start"]
        out["finish"] = a["act_end"] or a["finish"]
        out["finish_var"] = _dd(out["finish"], a["bl_finish"])
        out["critical"] = "Y" if a["longest"] else "N"
        out["trade"] = self.tmap().get(a["code"], "")
        return out

    # ---- 값
    def scalar(self, key: str):
        r, s = self.r, self.r["summary"]
        inc = [a for a in r["activities"] if a["status_code"] != "TK_Complete"]
        dd = date.fromisoformat(r["data_date"])
        p = self.prev()
        simple = {
            "project.name": r["name"], "project.data_date": r["data_date"], "project.start": s.get("start"),
            "project.finish": r["finish"], "project.must_finish": r["must_finish"],
            "project.margin_days": _dd(r["must_finish"], r["finish"]),
            "project.progress_pct": s["progress_pct"], "project.activities": s["activities"],
            "project.completed": s["completed"], "project.in_progress": s["in_progress"], "project.not_started": s["not_started"],
            "project.relationships": s["relationships"], "project.remaining_workdays": s["remaining_workdays"],
            "project.longest_count": sum(1 for a in inc if a["longest"]),
            "project.negative_float_count": sum(1 for a in inc if a["tf"] is not None and a["tf"] < 0),
            "project.calc_mode": "Progress Override" if (r.get("options") or {}).get("progress_override") else "Retained Logic",
            "report.date": date.today().isoformat(), "report.author": self.user or "",
            "report.month": f"{dd.year}년 {dd.month}월",
            "dcma.pass": sum(1 for d in r["dcma"] if d["pass"]),
        }
        if key in simple:
            return simple[key]
        if key.startswith("prev."):
            if not p:
                return None
            pr = p["result"]
            return {"prev.data_date": pr["data_date"], "prev.finish": pr["finish"],
                    "prev.finish_slip": _dd(r["finish"], pr["finish"]),
                    "prev.progress_pct": pr["summary"]["progress_pct"]}.get(key)
        if key.startswith("baseline."):
            v = self._memo("var", lambda: _evm.baseline_variance(r, None))
            return {"baseline.finish": v["bl_project_finish"], "baseline.variance_days": v["project_var"],
                    "baseline.late_count": v["late_count"]}.get(key)
        if key.startswith("health."):
            h = self.health()
            return {"health.score": h["score"], "health.grade": h["grade"]}.get(key)
        if key.startswith("evm."):
            e = self.evm()
            return e.get(key[4:]) if e.get("available") else None
        if key == "risk.open_count":
            return sum(1 for x in services.risks(self.uid) if x["status"] != "closed")
        if key.startswith("risk."):
            m = self.sim()
            return {"risk.p50": m["p50"], "risk.p80": m["p80"], "risk.p90": m["p90"],
                    "risk.prob_target": m["prob_meet_target"]}.get(key)
        if key.startswith("ppc."):
            w = [x for x in services.ppc(r["name"])["weeks"] if x["ppc"] is not None]
            if not w:
                return None
            return w[-1]["ppc"] if key == "ppc.last" else round(sum(x["ppc"] for x in w[-4:]) / len(w[-4:]))
        if key.startswith("constraint."):
            cs = [c for c in storage.rec_list("constraint", r["name"]) if c.get("status") != "해결"]
            if key == "constraint.open_count":
                return len(cs)
            return sum(1 for c in cs if c.get("due") and c["due"] < date.today().isoformat())
        if key.startswith("summary."):
            sec = self.report()
            return {"summary.headline": sec["headline"], "summary.text": sec["summary"],
                    "summary.delay_causes": sec["delay_causes"], "summary.next_month": sec["next_month"],
                    "summary.risks_actions": sec["risks_actions"]}.get(key)
        raise KeyError(key)

    def items(self, name: str) -> list[dict]:
        return self._memo("list:" + name, lambda: self._items(name))

    def _items(self, name: str) -> list[dict]:
        r = self.r
        acts = r["activities"]
        inc = [a for a in acts if a["status_code"] != "TK_Complete" and not a.get("summary_type")]
        by_start = lambda xs: sorted(xs, key=lambda a: (a["start"], a["code"]))
        if name == "activities":
            return [self.act(a) for a in acts]
        if name == "open":
            return [self.act(a) for a in by_start(inc)]
        if name == "critical":
            return [self.act(a) for a in by_start([a for a in inc if a["longest"]])]
        if name == "near_critical":
            return [self.act(a) for a in sorted([a for a in inc if a["tf"] is not None and 0 < a["tf"] <= 10 and not a["longest"]],
                                                key=lambda a: (a["tf"], a["start"]))]
        if name == "milestones":
            return [self.act(a) for a in sorted([a for a in acts if a["milestone"]], key=lambda a: a["finish"])]
        if name == "lookahead":
            return [self.act(a) for a in insights.lookahead(r, 30)]
        if name == "late":
            xs = [self.act(a) for a in acts]
            return sorted([x for x in xs if (x["finish_var"] or 0) > 0], key=lambda x: -x["finish_var"])
        if name in ("completed_period", "started_period"):
            p = self.prev()
            since = p["result"]["data_date"] if p else "0000-00-00"
            k = "act_end" if name == "completed_period" else "act_start"
            return [self.act(a) for a in acts if a[k] and since <= a[k] < r["data_date"]]
        if name == "wbs":
            groups: dict[str, list] = {}
            for a in acts:
                groups.setdefault((a["wbs"] or "(WBS 없음)").split(" > ")[0], []).append(a)
            out = []
            for g, xs in groups.items():
                tot = sum(a["orig_dur"] for a in xs) or 1
                fin = max(a["act_end"] or a["finish"] for a in xs)
                blf = max((a["bl_finish"] for a in xs if a["bl_finish"]), default=None)
                out.append({"name": g, "activities": len(xs),
                            "progress_pct": round(sum(a["orig_dur"] * a["pct"] for a in xs) / tot, 1),
                            "start": min(a["act_start"] or a["start"] for a in xs), "finish": fin, "bl_finish": blf,
                            "finish_var": _dd(fin, blf), "critical": sum(1 for a in xs if a["longest"])})
            return sorted(out, key=lambda x: x["start"])
        if name == "delay_top":
            d = services.delay(self.uid, self.base)
            return [x for x in d.get("top", []) if (x["introduced"] or 0) > 0] if d.get("available") else []
        if name == "changes":
            f = services.forensic(self.uid, self.base)
            return f["changes"]["items"] if f.get("available") else []
        if name == "risks":
            return [{**x, "codes": ", ".join(x["codes"]), "status": {"open": "열림", "mitigating": "대응중", "closed": "종결"}.get(x["status"], x["status"])}
                    for x in services.risks(self.uid)]
        if name == "constraints":
            return [c for c in storage.rec_list("constraint", r["name"]) if c.get("status") != "해결"]
        if name == "ppc_weeks":
            return services.ppc(r["name"])["weeks"]
        if name == "dcma":
            return [{"no": d["no"], "name": d["name"], "value": d["value"], "threshold": d["threshold"],
                     "result": "참고" if d["threshold"] == "참고" else "통과" if d["pass"] else "미달"} for d in r["dcma"]]
        if name == "health_failed":
            return [m for m in self.health()["metrics"] if m["pass"] is False]
        if name == "trend":
            return services.forensic(self.uid)["trend"]
        if name == "trades":
            return services.trade_summary(self.uid)["summary"]
        if name == "scurve":
            sc = r["s_curve"]
            return [{"date": d, "baseline": b, "early": e, "late": l}
                    for d, b, e, l in zip(sc["dates"], sc["baseline"], sc["early"], sc["late"])]
        if name == "evm_history":
            e = self.evm()
            return e.get("history", []) if e.get("available") else []
        raise KeyError(name)


def field_catalog() -> dict:
    return {"scalars": [{"key": k, "desc": v[0], "example": v[1]} for k, v in SCALARS.items()],
            "lists": [{"name": k, "desc": v[0], "fields": [{"key": f, "desc": d} for f, d in v[1].items()]}
                      for k, v in LISTS.items()]}
