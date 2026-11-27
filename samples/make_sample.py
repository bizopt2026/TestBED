"""데모용 샘플 XER 생성기: python samples/make_sample.py > samples/sample_project.xer"""
from datetime import date, timedelta

CAL5 = ("(0||CalendarData()( (0||DaysOfWeek()( (0||1()()) "
        + " ".join(f"(0||{d}()( (0||0(s|08:00|f|12:00)()) (0||1(s|13:00|f|17:00)())))" for d in range(2, 7))
        + " (0||7()()))) (0||Exceptions()( (0||0(d|46069)()) (0||1(d|46070)()) (0||2(d|46071)()) (0||3(d|46147)()))))")
CAL7 = ("(0||CalendarData()( (0||DaysOfWeek()( "
        + " ".join(f"(0||{d}()( (0||0(s|08:00|f|16:00)())))" for d in range(1, 8)) + "))))")

TABLES = []


def table(name, fields, rows):
    TABLES.append(f"%T\t{name}\n%F\t" + "\t".join(fields) + "\n"
                  + "".join("%R\t" + "\t".join(str(r.get(f, "")) for f in fields) + "\n" for r in rows))


DD = date(2026, 3, 2)
table("CALENDAR", ["clndr_id", "default_flag", "clndr_name", "day_hr_cnt", "clndr_data"], [
    {"clndr_id": 1, "default_flag": "Y", "clndr_name": "주5일(공휴일 반영)", "day_hr_cnt": 8, "clndr_data": CAL5},
    {"clndr_id": 2, "default_flag": "N", "clndr_name": "주7일(양생)", "day_hr_cnt": 8, "clndr_data": CAL7},
])
table("PROJECT", ["proj_id", "proj_short_name", "clndr_id", "plan_start_date", "plan_end_date",
                  "last_recalc_date", "export_flag"], [
    {"proj_id": 100, "proj_short_name": "SAMPLE-물류센터 신축공사", "clndr_id": 1,
     "plan_start_date": "2026-01-05 08:00", "plan_end_date": "2026-09-30 17:00",
     "last_recalc_date": f"{DD} 08:00", "export_flag": "Y"}])
wbs = [(1, "", "물류센터 신축공사", "Y"), (2, 1, "1. 착공 및 가설", "N"), (3, 1, "2. 토목/기초", "N"),
       (4, 1, "3. 골조", "N"), (5, 1, "4. 마감/설비", "N"), (6, 1, "5. 준공", "N")]
table("PROJWBS", ["wbs_id", "proj_id", "parent_wbs_id", "wbs_short_name", "wbs_name", "proj_node_flag"],
      [{"wbs_id": w, "proj_id": 100, "parent_wbs_id": p, "wbs_short_name": n.split(" ")[0], "wbs_name": n,
        "proj_node_flag": f} for w, p, n, f in wbs])

# code, name, wbs, dur(d), cal, type, status, act_start, act_end, pct, cstr
acts = [
    ("A1000", "착공", 2, 0, 1, "TT_Mile", "TK_Complete", "2026-01-05", "2026-01-05", 100, None),
    ("A1010", "가설울타리 및 현장사무소", 2, 10, 1, "TT_Task", "TK_Complete", "2026-01-05", "2026-01-16", 100, None),
    ("A1020", "측량 및 부지정지", 3, 15, 1, "TT_Task", "TK_Complete", "2026-01-12", "2026-02-06", 100, None),
    ("A1030", "파일 시공", 3, 25, 1, "TT_Task", "TK_Active", "2026-02-09", None, 60, None),
    ("A1040", "기초 터파기", 3, 10, 1, "TT_Task", "TK_Active", "2026-02-23", None, 30, None),
    ("A1050", "기초 철근/거푸집", 3, 12, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A1060", "기초 콘크리트 타설", 3, 3, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A1070", "기초 양생", 3, 7, 2, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A1080", "지하 배관 매설", 3, 15, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A2000", "철골 제작(공장)", 4, 40, 1, "TT_Task", "TK_Active", "2026-02-16", None, 25, None),
    ("A2010", "철골 세우기", 4, 30, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A2020", "데크플레이트 설치", 4, 15, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A2030", "슬래브 타설", 4, 10, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A2040", "골조 완료", 4, 0, 1, "TT_FinMile", "TK_NotStart", None, None, 0, None),
    ("A3000", "지붕 패널", 5, 20, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A3010", "외벽 패널", 5, 25, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A3020", "전기 간선/배선", 5, 30, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A3030", "기계설비 배관", 5, 35, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A3040", "소방설비", 5, 20, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A3050", "바닥 에폭시", 5, 12, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A3060", "도크 레벨러 설치", 5, 8, 1, "TT_Task", "TK_NotStart", None, None, 0, ("CS_MSOA", "2026-07-01")),
    ("A3070", "조경 및 포장", 5, 20, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A4000", "시운전", 6, 10, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A4010", "사용승인 검사", 6, 5, 1, "TT_Task", "TK_NotStart", None, None, 0, None),
    ("A4020", "준공", 6, 0, 1, "TT_FinMile", "TK_NotStart", None, None, 0, None),
]
rels = [("A1000", "A1010", "FS", 0), ("A1000", "A1020", "SS", 5), ("A1020", "A1030", "FS", 0),
        ("A1030", "A1040", "SS", 10), ("A1040", "A1050", "FS", 0), ("A1050", "A1060", "FS", 0),
        ("A1060", "A1070", "FS", 0), ("A1040", "A1080", "SS", 5), ("A1000", "A2000", "FS", 20),
        ("A1070", "A2010", "FS", 0), ("A2000", "A2010", "FS", 0), ("A2010", "A2020", "SS", 10),
        ("A2020", "A2030", "FS", 0), ("A2030", "A2040", "FS", 0), ("A2010", "A3000", "FF", 10),
        ("A2010", "A3010", "FS", 0), ("A2040", "A3020", "FS", 0), ("A2040", "A3030", "FS", 0),
        ("A3030", "A3040", "SS", 10), ("A3020", "A3050", "FS", 0), ("A3030", "A3050", "FS", 0),
        ("A3010", "A3060", "FS", 0), ("A1080", "A3070", "FS", -5), ("A3040", "A4000", "FS", 0),
        ("A3050", "A4000", "FS", 0), ("A3060", "A4000", "FS", 0), ("A4000", "A4010", "FS", 0),
        ("A4010", "A4020", "FS", 0), ("A3000", "A4000", "FS", 0)]

# 계획(Target) 날짜: 단순 근사 (데모용)
start = date(2026, 1, 5)
tasks, preds, rsrc = [], [], []
for i, (code, name, w, dur, cal, tt, st, s, e, pct, cs) in enumerate(acts, start=1000):
    bl_s = start + timedelta(days=(i - 1000) * 7)
    bl_e = bl_s + timedelta(days=int(dur * 1.4))
    t = {"task_id": i, "proj_id": 100, "wbs_id": w, "clndr_id": cal, "task_code": code, "task_name": name,
         "task_type": tt, "status_code": st, "phys_complete_pct": pct,
         "target_drtn_hr_cnt": dur * 8, "remain_drtn_hr_cnt": round(dur * 8 * (1 - pct / 100)),
         "act_start_date": f"{s} 08:00" if s else "", "act_end_date": f"{e} 17:00" if e else "",
         "target_start_date": f"{bl_s} 08:00", "target_end_date": f"{bl_e} 17:00",
         "cstr_type": cs[0] if cs else "", "cstr_date": f"{cs[1]} 08:00" if cs else ""}
    tasks.append(t)
    if tt == "TT_Task" and code not in ("A3070",):
        cost = dur * 1_000_000 * (2 if w == 4 else 1)          # 원공기 × 일당 단가(원)
        spent = cost * pct / 100 * (1.15 if code in ("A2000", "A1030") else 1.0)  # 일부 작업 원가 초과
        qty = dur * 8 * (6 if w in (3, 4) else 3)              # 인시(man-hour)
        rsrc.append({"taskrsrc_id": i, "task_id": i, "proj_id": 100, "rsrc_id": 1 if w != 4 else 2,
                     "target_cost": cost, "act_reg_cost": round(spent), "act_ot_cost": 0,
                     "remain_cost": round(cost * (1 - pct / 100)), "target_qty": qty,
                     "remain_qty": round(qty * (1 - pct / 100))})
ids = {a[0]: i for i, a in enumerate(acts, start=1000)}
for n, (p, s, t, lag) in enumerate(rels):
    preds.append({"task_pred_id": n + 1, "task_id": ids[s], "pred_task_id": ids[p], "proj_id": 100,
                  "pred_proj_id": 100, "pred_type": f"PR_{t}", "lag_hr_cnt": lag * 8})
F = ["task_id", "proj_id", "wbs_id", "clndr_id", "task_code", "task_name", "task_type", "status_code",
     "phys_complete_pct", "target_drtn_hr_cnt", "remain_drtn_hr_cnt", "act_start_date", "act_end_date",
     "target_start_date", "target_end_date", "cstr_type", "cstr_date"]
table("TASK", F, tasks)
table("TASKPRED", ["task_pred_id", "task_id", "pred_task_id", "proj_id", "pred_proj_id", "pred_type",
                   "lag_hr_cnt"], preds)
table("RSRC", ["rsrc_id", "rsrc_short_name", "rsrc_name", "rsrc_type"], [
    {"rsrc_id": 1, "rsrc_short_name": "LAB", "rsrc_name": "일반 노무", "rsrc_type": "RT_Labor"},
    {"rsrc_id": 2, "rsrc_short_name": "STL", "rsrc_name": "철골 작업조", "rsrc_type": "RT_Labor"}])
table("TASKRSRC", ["taskrsrc_id", "task_id", "proj_id", "rsrc_id", "target_cost", "act_reg_cost", "act_ot_cost",
                   "remain_cost", "target_qty", "remain_qty"], rsrc)

print("ERMHDR\t19.12\t2026-03-02\tProject\tadmin\tadmin\tdbxDatabaseNoName\tProject Management\tKRW")
print("".join(TABLES) + "%E")
