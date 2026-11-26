"""P6 캘린더(CALENDAR.clndr_data) 해석 및 작업일 연산.

시간 단위는 '일'이며, 시각(instant)은 date.toordinal() 정수로 표현한다.
  - 시작 시각  = 해당 작업일의 0시   -> wd[i]
  - 종료 시각  = 해당 작업일의 24시  -> wd[i] + 1
"""
from __future__ import annotations

import re
from bisect import bisect_left
from datetime import date, timedelta

EXCEL_EPOCH = date(1899, 12, 30)

# P6: 1=일요일 ... 7=토요일  ->  Python weekday(): 월=0 ... 일=6
P6_DAY_TO_PY = {1: 6, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5}


def _day_blocks(data: str, section: str) -> str:
    """'(0||Section()( ... ))' 의 내부 문자열을 괄호 짝을 맞춰 추출."""
    idx = data.find(f"{section}()")
    if idx < 0:
        return ""
    start = data.find("(", idx + len(section) + 2)
    if start < 0:
        return ""
    depth = 0
    for i in range(start, len(data)):
        if data[i] == "(":
            depth += 1
        elif data[i] == ")":
            depth -= 1
            if depth == 0:
                return data[start + 1 : i]
    return data[start + 1 :]


def _split_entries(body: str) -> list[str]:
    """최상위 '(0||...)' 엔트리 분리."""
    out, depth, buf = [], 0, []
    for ch in body:
        if ch == "(":
            depth += 1
        if depth > 0:
            buf.append(ch)
        if ch == ")":
            depth -= 1
            if depth == 0:
                out.append("".join(buf))
                buf = []
    return out


def parse_clndr_data(data: str) -> tuple[set[int], dict[date, bool]]:
    """(작업 요일 집합[python weekday], 예외일 {날짜: 작업여부}) 반환."""
    data = data or ""
    workdays: set[int] = set()
    dow = _day_blocks(data, "DaysOfWeek")
    for entry in _split_entries(dow):
        m = re.match(r"\(0\|\|(\d)\(\)\((.*)\)\)$", entry, re.S)
        if not m:
            continue
        day = int(m.group(1))
        if "s|" in m.group(2) and day in P6_DAY_TO_PY:
            workdays.add(P6_DAY_TO_PY[day])
    exceptions: dict[date, bool] = {}
    exc = _day_blocks(data, "Exceptions")
    for entry in _split_entries(exc):
        m = re.match(r"\(0\|\|\d+\(d\|(\d+)\)\((.*)\)\)$", entry, re.S)
        if not m:
            continue
        d = EXCEL_EPOCH + timedelta(days=int(m.group(1)))
        exceptions[d] = "s|" in m.group(2)
    if not dow:
        workdays = {0, 1, 2, 3, 4}
    return workdays, exceptions


class WorkCalendar:
    def __init__(self, clndr_id: str, name: str, day_hours: float,
                 workdays: set[int], exceptions: dict[date, bool],
                 start: date, end: date):
        self.id = clndr_id
        self.name = name
        self.day_hours = day_hours if day_hours > 0 else 8.0
        self.workdays = workdays
        self.exceptions = exceptions
        if not workdays and not any(exceptions.values()):
            self.workdays = {0, 1, 2, 3, 4}
        self.wd: list[int] = []
        o0, o1 = start.toordinal(), end.toordinal()
        for o in range(o0, o1 + 1):
            if self.is_workday(date.fromordinal(o)):
                self.wd.append(o)
        if not self.wd:  # 방어: 작업일이 하나도 없으면 매일 작업
            self.wd = list(range(o0, o1 + 1))

    def is_workday(self, d: date) -> bool:
        if d in self.exceptions:
            return self.exceptions[d]
        return d.weekday() in self.workdays

    # --- 기본 연산 -------------------------------------------------------
    def co(self, x: int) -> int:
        """x 이전(미만)의 작업일 수 = x 이상인 첫 작업일의 인덱스."""
        return bisect_left(self.wd, x)

    def _at(self, i: int) -> int:
        if i < 0:
            return self.wd[0] + i  # 범위 밖: 근사
        if i >= len(self.wd):
            return self.wd[-1] + (i - len(self.wd) + 1)
        return self.wd[i]

    def start_of(self, i: int) -> int:
        return self._at(i)

    def end_of(self, i: int) -> int:
        return self._at(i) + 1

    def shift(self, x: int, lag: int) -> int:
        """시각 x 에서 lag 작업일 이동한 시작 시각."""
        if lag == 0:
            return x
        return self._at(self.co(x) + lag)

    def unshift(self, x: int, lag: int) -> int:
        if lag == 0:
            return x
        return self._at(self.co(x) - lag)

    def workdays_between(self, a: int, b: int) -> int:
        """[a, b) 구간 작업일 수 (b<a 면 음수)."""
        return self.co(b) - self.co(a)

    def hours_to_days(self, hours: float) -> int:
        if hours <= 0:
            return 0 if hours == 0 else -max(1, round(-hours / self.day_hours))
        return max(1, round(hours / self.day_hours))
