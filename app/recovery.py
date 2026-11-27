"""자동 만회안 탐색: 목표 일수만큼 준공을 당기는 공기 단축(Crashing)·병행(Fast-tracking) 조합 탐색.

탐욕 알고리즘: 매 단계 최장경로 위에서 '1일 당기는 비용'이 가장 싼 조치를 하나 적용하고 재계산한다.
  - 단축: 잔여공기를 1일 줄임 (작업별 최대 단축률, 일당 비용)
  - 병행: 최장경로 FS 관계를 SS + Lag(선행 잔여공기의 일정 비율)로 바꿈 (위험 가중치)
결과는 What-if/XER 내보내기와 같은 변경 op 목록으로 반환한다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .schedule import MILESTONES, SUMMARY_TYPES, Schedule


@dataclass
class Policy:
    name: str
    crash: bool = True
    fast_track: bool = True
    max_crash_ratio: float = 0.3      # 잔여공기의 최대 30% 단축
    fast_track_overlap: float = 0.5   # 병행 시 선행 잔여공기의 50%만큼 겹침
    crash_cost_per_day: float = 1.0   # 기본 단축 비용(상대값)
    fast_track_cost: float = 3.0      # 병행 1건당 위험 비용(상대값)


POLICIES = [
    Policy("단축 우선(Crashing)", crash=True, fast_track=False),
    Policy("병행 우선(Fast-tracking)", crash=False, fast_track=True),
    Policy("혼합(최소 비용)", crash=True, fast_track=True),
]


def search(s: Schedule, target_days: int, policy: Policy, cost_of: dict[str, float] | None = None,
           exclude: set[str] | None = None, max_steps: int = 400) -> dict:
    cost_of, exclude = cost_of or {}, exclude or set()
    orig = {a.id: a.rem_dur for a in s.acts.values()}
    orig_rel = [(r, r.type, r.lag) for r in s.rels]
    start_finish = s.finish
    crashed: dict[str, int] = {}
    fast: list = []
    steps = 0
    try:
        while s.finish - start_finish > -target_days and steps < max_steps:
            steps += 1
            lp = [a for a in s.acts.values() if a.longest and a.status != "TK_Complete"
                  and a.task_type not in MILESTONES and a.task_type not in SUMMARY_TYPES and a.code not in exclude]
            options = []
            if policy.crash:
                for a in lp:
                    floor = math.ceil(orig[a.id] * (1 - policy.max_crash_ratio))
                    if a.rem_dur - 1 >= max(1, floor):
                        options.append((cost_of.get(a.code, policy.crash_cost_per_day), "crash", a))
            if policy.fast_track:
                lp_ids = {a.id for a in lp}
                for a in lp:
                    for r in a.preds:
                        p = s.acts[r.pred]
                        if (r.type == "FS" and r.pred in lp_ids and p.status == "TK_NotStart" and a.status == "TK_NotStart"
                                and p.rem_dur >= 4 and r not in [f[0] for f in fast]):
                            options.append((policy.fast_track_cost, "fast", r))
            if not options:
                break
            options.sort(key=lambda o: o[0])
            before = s.finish
            applied = False
            for cost, kind, obj in options[:8]:  # 효과 없는 조치는 되돌리고 다음 후보 시도
                if kind == "crash":
                    obj.rem_dur -= 1
                else:
                    p = s.acts[obj.pred]
                    old = (obj.type, obj.lag)
                    obj.type, obj.lag = "SS", max(1, math.ceil(p.rem_dur * (1 - policy.fast_track_overlap)))
                s.compute()
                if s.finish < before:
                    if kind == "crash":
                        crashed[obj.code] = crashed.get(obj.code, 0) + 1
                    else:
                        fast.append((obj, old))
                    applied = True
                    break
                if kind == "crash":
                    obj.rem_dur += 1
                else:
                    obj.type, obj.lag = old
                s.compute()
            if not applied:
                break
        gained = start_finish - s.finish
        by_id = {a.id: a for a in s.acts.values()}
        changes = [{"op": "set_duration", "code": c, "days": orig[[a for a in s.acts.values() if a.code == c][0].id] - d}
                   for c, d in crashed.items()]
        for r, _ in fast:
            changes.append({"op": "remove_rel", "pred": by_id[r.pred].code, "succ": by_id[r.succ].code})
            changes.append({"op": "add_rel", "pred": by_id[r.pred].code, "succ": by_id[r.succ].code,
                            "type": "SS", "lag": r.lag})
        cost = sum(cost_of.get(c, policy.crash_cost_per_day) * d for c, d in crashed.items()) + \
            len(fast) * policy.fast_track_cost
        return {"policy": policy.name, "target_days": target_days, "gained_days": gained,
                "achieved": gained >= target_days, "relative_cost": round(cost, 1),
                "crashed": [{"code": c, "name": next(a.name for a in s.acts.values() if a.code == c), "days": d}
                            for c, d in sorted(crashed.items(), key=lambda x: -x[1])],
                "fast_tracked": [{"pred": by_id[r.pred].code, "succ": by_id[r.succ].code, "lag": r.lag} for r, _ in fast],
                "changes": changes}
    finally:
        for a in s.acts.values():
            a.rem_dur = orig[a.id]
        for r, t, l in orig_rel:
            r.type, r.lag = t, l
        s.compute()
