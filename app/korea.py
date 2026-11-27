"""국내 특화: 법정공휴일 캘린더, 캘린더 공휴일 누락 점검, 기상 비작업일 기반 적정 공기 검토.

음력 공휴일(설날, 부처님오신날, 추석) 날짜는 아래 표를 사용한다. 정부 공고(관보)로
확정되는 임시공휴일·선거일은 포함하지 않으며, 관리자가 '추가 휴일'로 등록할 수 있다.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

from .calendar import EXCEL_EPOCH, parse_clndr_data

LUNAR = {  # 연도: (설날 당일, 부처님오신날, 추석 당일)
    2024: ("2024-02-10", "2024-05-15", "2024-09-17"),
    2025: ("2025-01-29", "2025-05-05", "2025-10-06"),
    2026: ("2026-02-17", "2026-05-24", "2026-09-25"),
    2027: ("2027-02-07", "2027-05-13", "2027-09-15"),
    2028: ("2028-01-27", "2028-05-02", "2028-10-03"),
    2029: ("2029-02-13", "2029-05-20", "2029-09-22"),
    2030: ("2030-02-03", "2030-05-09", "2030-09-12"),
}
FIXED = [("01-01", "신정"), ("03-01", "삼일절"), ("05-05", "어린이날"), ("06-06", "현충일"),
         ("08-15", "광복절"), ("10-03", "개천절"), ("10-09", "한글날"), ("12-25", "성탄절")]
# 대체공휴일 적용 대상 (2021년 이후 확대, 2023년 부처님오신날·성탄절 추가)
SUBST_WEEKEND = {"삼일절", "어린이날", "광복절", "개천절", "한글날", "부처님오신날", "성탄절"}


def holidays(year: int, extra: list[dict] | None = None) -> dict[date, str]:
    h: dict[date, str] = {}
    for md, name in FIXED:
        h[date.fromisoformat(f"{year}-{md}")] = name
    if year in LUNAR:
        seol, buddha, chuseok = (date.fromisoformat(x) for x in LUNAR[year])
        for d in (seol - timedelta(days=1), seol, seol + timedelta(days=1)):
            h[d] = "설날 연휴"
        h[buddha] = h.get(buddha, "") + ("·" if buddha in h else "") + "부처님오신날"
        for d in (chuseok - timedelta(days=1), chuseok, chuseok + timedelta(days=1)):
            h[d] = h.get(d, "") + ("·" if d in h else "") + "추석 연휴"
    # 대체공휴일
    subs = {}
    taken = set(h)

    def next_free(d):
        d += timedelta(days=1)
        while d.weekday() >= 5 or d in taken or d in subs:
            d += timedelta(days=1)
        return d

    for d, name in sorted(h.items()):
        if "설날" in name or "추석" in name:
            if d.weekday() == 6 or "·" in name:  # 일요일 또는 다른 공휴일과 겹침
                subs[next_free(max(x for x, n in h.items() if (("설날" in n) if "설날" in name else ("추석" in n))))] = "대체공휴일"
        elif any(k in name for k in SUBST_WEEKEND) and (d.weekday() >= 5 or "·" in name):
            subs[next_free(d)] = "대체공휴일"
    h.update(subs)
    for e in extra or []:
        try:
            d = date.fromisoformat(e["date"])
        except (KeyError, ValueError):
            continue
        if d.year == year:
            h[d] = e.get("name") or "추가 휴일"
    return dict(sorted(h.items()))


def holidays_between(d0: date, d1: date, extra=None) -> dict[date, str]:
    out = {}
    for y in range(d0.year, d1.year + 1):
        out.update({d: n for d, n in holidays(y, extra).items() if d0 <= d <= d1})
    return out


def calendar_check(tables: dict, proj_id: str, d0: date, d1: date, extra=None) -> list[dict]:
    hol = holidays_between(d0, d1, extra)
    used = {t.get("clndr_id") for t in tables.get("TASK", []) if t.get("proj_id") == proj_id}
    out = []
    for c in tables.get("CALENDAR", []):
        if c.get("clndr_id") not in used:
            continue
        wdays, exc = parse_clndr_data(c.get("clndr_data", ""))
        seven = len(wdays) == 7
        missing = [{"date": d.isoformat(), "name": n} for d, n in hol.items()
                   if (exc[d] if d in exc else d.weekday() in wdays)]
        out.append({"clndr_id": c["clndr_id"], "name": c.get("clndr_name", ""), "workdays": sorted(wdays),
                    "seven_day": seven, "missing": missing,
                    "note": "주7일 캘린더(양생 등)는 공휴일 작업이 의도일 수 있습니다." if seven else ""})
    return out


def add_holidays_to_clndr(clndr_data: str, days: list[date]) -> str:
    """clndr_data 의 Exceptions 블록에 비작업 예외일을 추가."""
    serials = [(d - EXCEL_EPOCH).days for d in days]
    existing = set(int(x) for x in re.findall(r"d\|(\d+)\)", clndr_data or ""))
    serials = [x for x in serials if x not in existing]
    if not serials:
        return clndr_data
    idx = len(existing)
    entries = " ".join(f"(0||{idx + i}(d|{sv})())" for i, sv in enumerate(serials))
    m = re.search(r"Exceptions\(\)\(", clndr_data or "")
    if m:
        pos = m.end()
        return clndr_data[:pos] + " " + entries + clndr_data[pos:]
    data = clndr_data or "(0||CalendarData()( (0||DaysOfWeek()()) ))"
    # 최상위 CalendarData 블록의 마지막 ')' 앞에 Exceptions 삽입
    k = data.rstrip().rfind(")")
    k = data[:k].rstrip().rfind(")") + 1 if k > 0 else len(data)
    return data[:k] + f" (0||Exceptions()( {entries}))" + data[k:]


def nonwork_review(cal_wdays: set[int], cal_exc: dict, d0: date, d1: date,
                   weather_days: dict[int, float], extra=None) -> dict:
    """월별 '필요 비작업일(공휴일 + 기상)'과 캘린더상 비작업일 비교.

    weather_days: {월(1~12): 기상 비작업일 수} - 지역 기상 통계로 산정해 입력 (기본값 없음).
    """
    hol = holidays_between(d0, d1, extra)
    rows = []
    cur = date(d0.year, d0.month, 1)
    while cur <= d1:
        nxt = date(cur.year + (cur.month == 12), cur.month % 12 + 1, 1)
        days = [cur + timedelta(days=i) for i in range((nxt - cur).days) if d0 <= cur + timedelta(days=i) <= d1]
        if days:
            cal_off = sum(1 for d in days if not (cal_exc[d] if d in cal_exc else d.weekday() in cal_wdays))
            weekend_hol = sum(1 for d in days if d.weekday() >= 5 or d in hol)
            ratio = len(days) / ((nxt - cur).days)
            weather = round(float(weather_days.get(cur.month, 0)) * ratio, 1)
            # 기상 비작업일 중 일부는 휴일과 겹치므로 휴일 비율만큼 차감
            overlap = weather * weekend_hol / len(days)
            required = round(weekend_hol + weather - overlap, 1)
            rows.append({"month": cur.strftime("%Y-%m"), "days": len(days), "calendar_nonwork": cal_off,
                         "holidays_weekends": weekend_hol, "weather": weather, "required_nonwork": required,
                         "shortage": round(max(0, required - cal_off), 1)})
        cur = nxt
    short = round(sum(r["shortage"] for r in rows), 1)
    return {"months": rows, "total_shortage_days": short,
            "note": "필요 비작업일 = 주말·공휴일 + 기상 비작업일(중복분 차감). 캘린더 비작업일이 부족하면 작업일을 과다하게 잡은 것이므로 공기가 부족할 수 있습니다."}
