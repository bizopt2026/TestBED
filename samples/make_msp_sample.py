"""MPXJ 로 MS Project 테스트 파일(MSPDI XML, MPX) 생성: python samples/make_msp_sample.py"""
import os

import jpype
import mpxj  # noqa: F401

jpype.startJVM()
from java.math import BigDecimal  # noqa: E402
from java.time import LocalDate, LocalDateTime  # noqa: E402
from org.mpxj import ConstraintType, Duration, ProjectFile, Relation, RelationType, TimeUnit  # noqa: E402
from org.mpxj.mpx import MPXWriter  # noqa: E402
from org.mpxj.mspdi import MSPDIWriter  # noqa: E402

here = os.path.dirname(os.path.abspath(__file__))
p = ProjectFile()
p.getProjectProperties().setProjectTitle("MSP 샘플 - 연구동 증축")
p.getProjectProperties().setStartDate(LocalDateTime.of(2026, 3, 2, 8, 0))
p.getProjectProperties().setStatusDate(LocalDateTime.of(2026, 4, 1, 8, 0))
cal = p.addDefaultBaseCalendar()
cal.setName("표준(공휴일)")
cal.addCalendarException(LocalDate.of(2026, 5, 5), LocalDate.of(2026, 5, 5))
p.setDefaultCalendar(cal)
r = p.addResource()
r.setName("골조팀")


def task(parent, name, days, pct=0, start=None, bl=None):
    t = (parent or p).addTask()
    t.setName(name)
    if days is not None:
        t.setDuration(Duration.getInstance(days, TimeUnit.DAYS))
    t.setPercentageComplete(pct)
    if start:
        t.setStart(LocalDateTime.of(*start, 8, 0))
    if bl:
        t.setBaselineStart(LocalDateTime.of(*bl[0], 8, 0))
        t.setBaselineFinish(LocalDateTime.of(*bl[1], 17, 0))
    return t


s1 = p.addTask(); s1.setName("토목")
s2 = p.addTask(); s2.setName("골조")
m0 = task(None, "착공", 0, 100, (2026, 3, 2), ((2026, 3, 2), (2026, 3, 2))); m0.setMilestone(True)
m0.setActualStart(LocalDateTime.of(2026, 3, 2, 8, 0)); m0.setActualFinish(LocalDateTime.of(2026, 3, 2, 8, 0))
t1 = task(s1, "터파기", 10, 50, (2026, 3, 3), ((2026, 3, 3), (2026, 3, 16)))
t1.setActualStart(LocalDateTime.of(2026, 3, 3, 8, 0))
t2 = task(s1, "기초 타설", 8, 0, None, ((2026, 3, 17), (2026, 3, 26)))
t3 = task(s2, "1층 골조", 15, 0, None, ((2026, 3, 27), (2026, 4, 16)))
t4 = task(s2, "2층 골조", 15, 0, None, ((2026, 4, 17), (2026, 5, 8)))
t4.setConstraintType(ConstraintType.START_NO_EARLIER_THAN); t4.setConstraintDate(LocalDateTime.of(2026, 5, 4, 8, 0))
m9 = task(None, "골조 완료", 0, 0, None, ((2026, 5, 8), (2026, 5, 8))); m9.setMilestone(True)
m9.setDeadline(LocalDateTime.of(2026, 6, 30, 17, 0))
for a, b, ty, lag in [(m0, t1, RelationType.FINISH_START, 0), (t1, t2, RelationType.FINISH_START, 2),
                      (t2, t3, RelationType.FINISH_START, 0), (t3, t4, RelationType.START_START, 5), (t4, m9, RelationType.FINISH_START, 0)]:
    b.addPredecessor(Relation.Builder().predecessorTask(a).type(ty).lag(Duration.getInstance(lag, TimeUnit.DAYS)))
for t, cost, act in [(t1, 2000000, 1100000), (t3, 6000000, 0), (t4, 6000000, 0)]:
    asg = t.addResourceAssignment(r)
    asg.setCost(BigDecimal(str(cost))); asg.setActualCost(BigDecimal(str(act))); asg.setRemainingCost(BigDecimal(str(cost - act)))
    asg.setWork(Duration.getInstance(t.getDuration().getDuration() * 8 * 4, TimeUnit.HOURS))
MSPDIWriter().write(p, os.path.join(here, "sample_msproject_full.xml"))
MPXWriter().write(p, os.path.join(here, "sample_msproject.mpx"))
print("ok")
