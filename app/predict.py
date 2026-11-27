"""업데이트 이력 학습 기반 지연 예측 (릿지 회귀, numpy).

학습 표본: 같은 프로젝트의 연속 업데이트 (t, t+1) 쌍에서 t 시점에 미완료였던 작업.
목표값: 다음 업데이트에서 예상 종료일이 밀린 일수.
표본이 부족하면 학습하지 않고 규칙 기반 위험 점수를 쓰도록 알린다.
"""
from __future__ import annotations

from datetime import date

import numpy as np

FEATURES = ["여유일", "잔여공기", "원공기", "공정률", "최장경로", "진행중", "계획 대비 지연", "착수까지 일수", "직전 순연"]
MIN_SAMPLES = 150


def _feat(a: dict, dd: str, prev_slip: float) -> list[float]:
    d = date.fromisoformat(dd)
    late = (date.fromisoformat(a["finish"]) - date.fromisoformat(a["bl_finish"])).days if a["bl_finish"] else 0
    to_start = max(0, (date.fromisoformat(a["start"]) - d).days)
    tf = a["tf"] if a["tf"] is not None else 0
    return [min(tf, 100), a["rem_dur"], a["orig_dur"], a["pct"], 1.0 if a["longest"] else 0.0,
            1.0 if a["status_code"] == "TK_Active" else 0.0, max(-60, min(late, 120)), min(to_start, 365), prev_slip]


def dataset(histories: list[list[dict]]):
    X, y = [], []
    for hist in histories:
        hist = sorted(hist, key=lambda h: h["result"]["data_date"])
        for i in range(len(hist) - 1):
            r0, r1 = hist[i]["result"], hist[i + 1]["result"]
            prev = {a["code"]: a for a in hist[i - 1]["result"]["activities"]} if i else {}
            nxt = {a["code"]: a for a in r1["activities"]}
            for a in r0["activities"]:
                if a["status_code"] == "TK_Complete" or a["milestone"] or a["code"] not in nxt:
                    continue
                p = prev.get(a["code"])
                ps = (date.fromisoformat(a["finish"]) - date.fromisoformat(p["finish"])).days if p else 0
                b = nxt[a["code"]]
                fin_b = b["act_end"] or b["finish"]
                X.append(_feat(a, r0["data_date"], ps))
                y.append(max(-60, min((date.fromisoformat(fin_b) - date.fromisoformat(a["finish"])).days, 120)))
    return np.array(X, dtype=float), np.array(y, dtype=float)


def train(histories: list[list[dict]], alpha: float = 5.0) -> dict:
    X, y = dataset(histories)
    n = len(y)
    if n < MIN_SAMPLES:
        return {"trained": False, "samples": int(n), "min_samples": MIN_SAMPLES,
                "message": f"학습 표본이 {n}개로 부족합니다(최소 {MIN_SAMPLES}개). 같은 프로젝트의 월간 업데이트가 쌓이면 자동으로 학습합니다."}
    rng = np.random.default_rng(0)
    idx = rng.permutation(n)
    cut = int(n * 0.8)
    tr, te = idx[:cut], idx[cut:]
    mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-9

    def fit(Xa, ya):
        Z = np.c_[np.ones(len(Xa)), (Xa - mu) / sd]
        I = np.eye(Z.shape[1]); I[0, 0] = 0
        return np.linalg.solve(Z.T @ Z + alpha * I, Z.T @ ya)

    w = fit(X[tr], y[tr])
    pred = np.c_[np.ones(len(te)), (X[te] - mu) / sd] @ w
    ss_res = float(((y[te] - pred) ** 2).sum())
    ss_tot = float(((y[te] - y[te].mean()) ** 2).sum()) or 1.0
    mae = float(np.abs(y[te] - pred).mean())
    w = fit(X, y)
    return {"trained": True, "samples": int(n), "r2": round(1 - ss_res / ss_tot, 3), "mae_days": round(mae, 1),
            "weights": [round(float(v), 3) for v in w], "mu": mu.tolist(), "sd": sd.tolist(),
            "importance": sorted([{"feature": f, "weight": round(float(v), 2)} for f, v in zip(FEATURES, w[1:])],
                                 key=lambda x: -abs(x["weight"]))}


def predict(model: dict, current: dict, prev: dict | None) -> list[dict]:
    if not model.get("trained"):
        return []
    w, mu, sd = np.array(model["weights"]), np.array(model["mu"]), np.array(model["sd"])
    pm = {a["code"]: a for a in prev["activities"]} if prev else {}
    out = []
    for a in current["activities"]:
        if a["status_code"] == "TK_Complete" or a["milestone"]:
            continue
        p = pm.get(a["code"])
        ps = (date.fromisoformat(a["finish"]) - date.fromisoformat(p["finish"])).days if p else 0
        x = (np.array(_feat(a, current["data_date"], ps)) - mu) / sd
        out.append({"code": a["code"], "name": a["name"], "predicted_slip": round(float(w[0] + x @ w[1:]), 1),
                    "longest": a["longest"], "tf": a["tf"]})
    out.sort(key=lambda r: -r["predicted_slip"])
    return out
