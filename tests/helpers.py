CAL5 = ("(0||CalendarData()( (0||DaysOfWeek()( (0||1()()) "
        + " ".join(f"(0||{d}()( (0||0(s|08:00|f|17:00)())))" for d in range(2, 7))
        + " (0||7()()))) (0||Exceptions()())))")


def build_xer(tasks, rels, data_date="2026-03-02", must_finish=""):
    """tasks: [(code, dur_days, status, act_start, act_end, type)], rels: [(pred, succ, type, lag_days)]"""
    out = ["ERMHDR\t19.12"]
    out += ["%T\tCALENDAR", "%F\tclndr_id\tdefault_flag\tclndr_name\tday_hr_cnt\tclndr_data",
            f"%R\t1\tY\t주5일\t8\t{CAL5}"]
    out += ["%T\tPROJECT", "%F\tproj_id\tproj_short_name\tclndr_id\tlast_recalc_date\tplan_end_date",
            f"%R\t1\tTEST\t1\t{data_date} 08:00\t{must_finish}"]
    out += ["%T\tTASK", "%F\ttask_id\tproj_id\twbs_id\tclndr_id\ttask_code\ttask_name\ttask_type\tstatus_code"
            "\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tact_start_date\tact_end_date"]
    for i, t in enumerate(tasks):
        code, dur, st, s, e, tt = (list(t) + [None] * 6)[:6]
        st = st or "TK_NotStart"
        tt = tt or "TT_Task"
        rem = 0 if st == "TK_Complete" else dur * 8
        out.append(f"%R\t{i + 1}\t1\t\t1\t{code}\t{code}\t{tt}\t{st}\t{dur * 8}\t{rem}\t{s or ''}\t{e or ''}")
    ids = {t[0]: i + 1 for i, t in enumerate(tasks)}
    out += ["%T\tTASKPRED", "%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt"]
    for i, (p, s, ty, lag) in enumerate(rels):
        out.append(f"%R\t{i + 1}\t{ids[s]}\t{ids[p]}\tPR_{ty}\t{lag * 8}")
    out.append("%E")
    return "\n".join(out).encode("utf-8")
