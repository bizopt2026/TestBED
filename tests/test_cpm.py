import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from helpers import build_xer  # noqa: E402

from app.analysis import analyze
from app.schedule import Schedule
from app.xer_parser import parse_xer


def run(tasks, rels, **kw):
    s = Schedule(parse_xer(build_xer(tasks, rels, **kw)))
    return {a["code"]: a for a in s.to_dict()["activities"]}, s


def test_fs_chain_skips_weekend():
    # 2026-03-02 월요일 Data Date
    a, s = run([("A", 5), ("B", 3)], [("A", "B", "FS", 0)])
    assert a["A"]["start"] == "2026-03-02" and a["A"]["finish"] == "2026-03-06"
    assert a["B"]["start"] == "2026-03-09" and a["B"]["finish"] == "2026-03-11"
    assert a["A"]["critical"] and a["B"]["critical"]


def test_parallel_float():
    a, _ = run([("S", 0, None, None, None, "TT_Mile"), ("A", 10), ("B", 4), ("E", 0, None, None, None, "TT_FinMile")],
               [("S", "A", "FS", 0), ("S", "B", "FS", 0), ("A", "E", "FS", 0), ("B", "E", "FS", 0)])
    assert a["B"]["tf"] == 6 and a["B"]["ff"] == 6
    assert a["A"]["tf"] == 0
    assert a["E"]["finish"] == "2026-03-13"  # 완료 마일스톤은 선행 종료일과 같은 날


def test_lags_and_types():
    a, _ = run([("A", 5), ("B", 5), ("C", 2), ("D", 3)],
               [("A", "B", "SS", 2), ("A", "C", "FS", 2), ("B", "D", "FF", 1)])
    assert a["B"]["start"] == "2026-03-04"        # SS+2
    assert a["C"]["start"] == "2026-03-11"        # 03-06 종료 + 2일(월,화) -> 수
    assert a["D"]["finish"] == "2026-03-11"       # B 종료 03-10 + FF 1
    assert a["D"]["start"] == "2026-03-09"


def test_negative_lag():
    a, _ = run([("A", 5), ("B", 3)], [("A", "B", "FS", -2)])
    assert a["B"]["start"] == "2026-03-05"


def test_progress_respects_data_date():
    a, _ = run([("A", 10, "TK_Complete", "2026-02-02 08:00", "2026-02-13 17:00"),
                ("B", 5, "TK_NotStart")], [("A", "B", "FS", 0)])
    assert a["A"]["finish"] == "2026-02-13"
    assert a["B"]["start"] == "2026-03-02"   # Data Date 이전으로 계획되지 않음


def test_must_finish_negative_float():
    a, s = run([("A", 10)], [], must_finish="2026-03-10 17:00")
    assert a["A"]["tf"] == -3  # 03-13 종료 vs 03-10 기한
    d = {x["no"]: x for x in analyze(s)["dcma"]}
    assert d[7]["pass"] is False and d[7]["count"] == 1


def test_loop_detected():
    a, s = run([("A", 2), ("B", 2)], [("A", "B", "FS", 0), ("B", "A", "FS", 0)])
    assert s.loops and s.warnings


def test_sample_file_analyzes():
    path = os.path.join(os.path.dirname(__file__), "..", "samples", "sample_project.xer")
    r = analyze(Schedule(parse_xer(open(path, "rb").read())))
    assert r["summary"]["activities"] == 25
    assert len(r["dcma"]) == 14
    assert any(x["longest"] for x in r["activities"])


def test_out_of_sequence_progress_keeps_logic():
    # B 가 A 완료 전에 착수(Out-of-sequence): Retained Logic 으로 A 는 여전히 B 잔여 작업을 구동
    a, _ = run([("A", 10, "TK_Active", "2026-02-23 08:00", None), ("B", 5, "TK_Active", "2026-02-27 08:00", None),
                ("C", 5)], [("A", "B", "FS", 0), ("B", "C", "FS", 0)])
    assert a["A"]["tf"] == 0 and a["B"]["tf"] == 0


def test_loe_spans_and_does_not_drive():
    a, s = run([("A", 5), ("B", 10), ("L", 1, None, None, None, "TT_LOE")],
               [("A", "B", "FS", 0), ("A", "L", "SS", 0), ("L", "B", "FF", 0)])
    assert a["L"]["start"] == a["A"]["start"] and a["L"]["finish"] == a["B"]["finish"]
    assert not a["L"]["longest"] and a["A"]["longest"]


def test_progress_override_ignores_logic_for_started():
    from app.schedule import Schedule
    from app.xer_parser import parse_xer
    from helpers import build_xer
    raw = build_xer([("A", 10, "TK_Active", "2026-02-23 08:00", None), ("B", 5, "TK_Active", "2026-02-27 08:00", None)],
                    [("A", "B", "FS", 0)])
    s1 = {x["code"]: x for x in Schedule(parse_xer(raw)).to_dict()["activities"]}
    s2 = {x["code"]: x for x in Schedule(parse_xer(raw), options={"progress_override": True}).to_dict()["activities"]}
    assert s1["B"]["finish"] > s2["B"]["finish"]   # Retained: A 종료 후 잔여 / Override: Data Date 부터 바로
