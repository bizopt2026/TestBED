"""업데이트 간 포렌식 비교: 변경 로그, 공기 압축(Compression) 탐지, 업데이트 추세."""
from __future__ import annotations

from datetime import date


def _wd(a: str, b: str) -> int:
    from datetime import timedelta
    d0, d1 = date.fromisoformat(a), date.fromisoformat(b)
    return sum(1 for i in range((d1 - d0).days) if (d0 + timedelta(days=i)).weekday() < 5)


def change_log(base: dict, target: dict) -> dict:
    ma = {a["code"]: a for a in base["activities"]}
    mb = {a["code"]: a for a in target["activities"]}
    ida = {a["id"]: a["code"] for a in base["activities"]}
    idb = {a["id"]: a["code"] for a in target["activities"]}
    log = []

    def add(cat, code, name, before, after, note=""):
        log.append({"category": cat, "code": code, "name": name, "before": before, "after": after, "note": note})

    for c in sorted(mb.keys() - ma.keys()):
        add("작업 추가", c, mb[c]["name"], "", f"{mb[c]['orig_dur']}일")
    for c in sorted(ma.keys() - mb.keys()):
        add("작업 삭제", c, ma[c]["name"], f"{ma[c]['orig_dur']}일", "", "완료 전 삭제" if ma[c]["status_code"] != "TK_Complete" else "")
    rel_a = {(ida[r["id"]], c, r["type"]): r["lag"] for c, a in ma.items() for r in a["preds"] if r["id"] in ida}
    rel_b = {(idb[r["id"]], c, r["type"]): r["lag"] for c, a in mb.items() for r in a["preds"] if r["id"] in idb}
    pairs_a = {(p, s): (t, l) for (p, s, t), l in rel_a.items()}
    pairs_b = {(p, s): (t, l) for (p, s, t), l in rel_b.items()}
    for (p, s) in sorted(pairs_b.keys() - pairs_a.keys()):
        t, l = pairs_b[(p, s)]
        add("관계 추가", s, f"{p} → {s}", "", f"{t}{'+' + str(l) if l else ''}")
    for (p, s) in sorted(pairs_a.keys() - pairs_b.keys()):
        t, l = pairs_a[(p, s)]
        on_lp = ma.get(s, {}).get("longest") or ma.get(p, {}).get("longest")
        add("관계 삭제", s, f"{p} → {s}", f"{t}{'+' + str(l) if l else ''}", "", "주공정 관계" if on_lp else "")
    for k in sorted(pairs_a.keys() & pairs_b.keys()):
        (ta, la), (tb, lb) = pairs_a[k], pairs_b[k]
        if ta != tb:
            add("관계 유형 변경", k[1], f"{k[0]} → {k[1]}", ta, tb)
        if la != lb:
            add("Lag 변경", k[1], f"{k[0]} → {k[1]}", la, lb, "Lag 축소" if lb < la else "")
    for c in sorted(ma.keys() & mb.keys()):
        a, b = ma[c], mb[c]
        if a["orig_dur"] != b["orig_dur"]:
            add("원공기 변경", c, b["name"], a["orig_dur"], b["orig_dur"], "단축" if b["orig_dur"] < a["orig_dur"] else "증가")
        if (a["constraint"], a["constraint_date"]) != (b["constraint"], b["constraint_date"]):
            add("제약 변경", c, b["name"], f"{a['constraint']} {a['constraint_date'] or ''}".strip(),
                f"{b['constraint']} {b['constraint_date'] or ''}".strip())
        if a["calendar"] != b["calendar"]:
            add("캘린더 변경", c, b["name"], a["calendar"], b["calendar"])
        if a["act_start"] and b["act_start"] and a["act_start"] != b["act_start"]:
            add("실착수일 변경", c, b["name"], a["act_start"], b["act_start"], "확정 실적 수정")
        if a["act_end"] and b["act_end"] and a["act_end"] != b["act_end"]:
            add("실완료일 변경", c, b["name"], a["act_end"], b["act_end"], "확정 실적 수정")
        if a["name"] != b["name"]:
            add("명칭 변경", c, b["name"], a["name"], b["name"])
    counts = {}
    for x in log:
        counts[x["category"]] = counts.get(x["category"], 0) + 1
    return {"items": log, "counts": counts}


def compression(base: dict, target: dict) -> dict:
    """공기 압축 탐지: 실제 진척 없이 잔여공기·원공기·Lag 를 줄여 준공일을 유지한 흔적."""
    ma = {a["code"]: a for a in base["activities"]}
    gap = _wd(base["data_date"], target["data_date"])
    rows = []
    for b in target["activities"]:
        a = ma.get(b["code"])
        if not a or b["status_code"] == "TK_Complete" or b["milestone"]:
            continue
        expected = a["rem_dur"]
        if a["status_code"] == "TK_Active" or b["status_code"] == "TK_Active":
            expected = max(0, a["rem_dur"] - gap)
        cut = expected - b["rem_dur"]
        progress = b["pct"] - a["pct"]
        if cut >= 2 and not (b["status_code"] == "TK_Active" and progress >= 100 * cut / max(b["orig_dur"], 1) * 0.8):
            rows.append({"code": b["code"], "name": b["name"], "rem_before": a["rem_dur"], "rem_after": b["rem_dur"],
                         "expected": expected, "cut": cut, "pct_before": a["pct"], "pct_after": b["pct"],
                         "longest": b["longest"], "tf": b["tf"]})
    rows.sort(key=lambda x: (not x["longest"], -x["cut"]))
    lp_cut = sum(x["cut"] for x in rows if x["longest"])
    slip = (date.fromisoformat(target["finish"]) - date.fromisoformat(base["finish"])).days
    return {"items": rows, "longest_path_cut_days": lp_cut, "finish_slip": slip,
            "suspected": lp_cut >= 5 and slip <= 0,
            "note": "실적 진척 없이 잔여공기를 줄인 작업입니다. 최장경로에서 줄어든 일수가 크고 준공일이 그대로라면 공기 압축(준공일 맞추기)을 의심할 수 있습니다."}


def trend(history: list[dict], health: dict[str, int] | None = None) -> list[dict]:
    health = health or {}
    out = []
    for h in sorted(history, key=lambda x: x["data_date"]):
        r = h["result"]
        inc = [a for a in r["activities"] if a["status_code"] != "TK_Complete"]
        out.append({"id": h["id"], "data_date": r["data_date"], "finish": r["finish"], "must_finish": r["must_finish"],
                    "progress": r["summary"]["progress_pct"], "longest": sum(1 for a in inc if a["longest"]),
                    "negative_float": sum(1 for a in inc if a["tf"] is not None and a["tf"] < 0),
                    "min_tf": min((a["tf"] for a in inc if a["tf"] is not None), default=None),
                    "dcma_pass": sum(d["pass"] for d in r["dcma"]), "health": health.get(h["id"])})
    for i, x in enumerate(out):
        x["finish_change"] = (date.fromisoformat(x["finish"]) - date.fromisoformat(out[i - 1]["finish"])).days if i else 0
    return out
