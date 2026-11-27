"""리스크·제약 양방향 동기화 (PMS 현장 ↔ PMS 대시보드).

규칙: 나중에 고친 쪽이 이긴다(updated_at 비교). 지운 것은 지운 시각(tomb)으로 비교한다.
진 쪽 내용은 동기화 기록(sync_log)에 남겨 되살릴 수 있게 한다.
"""
from __future__ import annotations

from datetime import datetime

from . import storage

KINDS = storage.SYNC_KINDS
META = ("id", "scope", "author", "created_at", "updated_at")
LOG_KEEP = 100


def _body(x: dict) -> dict:
    return {k: v for k, v in x.items() if k not in META}


def tombs(name: str) -> list[dict]:
    return [{"kind": t["kind"], "rid": t["rid"], "at": t["at"]} for t in storage.rec_list("tomb", name)]


def export(name: str) -> dict:
    out = {k: [{kk: vv for kk, vv in x.items() if kk != "scope"} for x in storage.rec_list(k, name)] for k in KINDS}
    out["tomb"] = tombs(name)
    return out


def _log(name: str, kind: str, item: dict, action: str, winner: str, by: str) -> None:
    storage.rec_put("sync_log", name, {"kind": kind, "rid": item.get("id"), "action": action, "winner": winner,
                                       "title": item.get("title") or item.get("desc") or item.get("name") or kind,
                                       "lost": _body(item), "lost_at": item.get("updated_at"), "lost_by": item.get("author"),
                                       "at": datetime.now().isoformat(timespec="seconds")}, by)
    logs = storage.rec_list("sync_log", name)
    for x in logs[:-LOG_KEEP]:
        storage.rec_del("sync_log", x["id"])


def merge(name: str, incoming: dict, other: str, by: str = "") -> dict:
    """incoming(상대편 export)을 name 프로젝트에 합친다. other: 상대편 이름(기록용, 예: '현장'·'대시보드')."""
    st = {"added": 0, "updated": 0, "deleted": 0, "kept": 0}
    mine_t = {(t["kind"], t["rid"]): t["at"] for t in tombs(name)}
    for kind in KINDS:
        local = {x["id"]: x for x in storage.rec_list(kind, name)}
        for x in incoming.get(kind) or []:
            rid, at = x.get("id"), x.get("updated_at") or ""
            if not rid:
                continue
            if mine_t.get((kind, rid), "") >= at and (kind, rid) in mine_t:
                st["kept"] += 1          # 여기서 더 나중에 지움
                continue
            l = local.get(rid)
            if l is None:
                storage.rec_put(kind, name, _body(x), x.get("author") or by, rid=rid, updated_at=at, created_at=x.get("created_at"))
                st["added"] += 1
            elif _body(l) == _body(x):
                continue
            elif at > (l.get("updated_at") or ""):
                _log(name, kind, l, "덮어씀", other, by)
                storage.rec_put(kind, name, _body(x), x.get("author") or by, rid=rid, updated_at=at)
                st["updated"] += 1
            else:
                st["kept"] += 1          # 여기 것이 더 최근 — 상대편이 다음 동기화 때 받는다
        for t in incoming.get("tomb") or []:
            if t.get("kind") != kind:
                continue
            l = local.get(t.get("rid"))
            if l and (t.get("at") or "") >= (l.get("updated_at") or ""):
                _log(name, kind, l, "삭제됨", other, by)
                storage.rec_del(kind, l["id"], at=t["at"])
                st["deleted"] += 1
            elif not l and (kind, t.get("rid")) not in mine_t:
                storage.tomb_put(name, kind, t["rid"], t["at"])
    return st


def log(name: str, limit: int = 30) -> list[dict]:
    return list(reversed(storage.rec_list("sync_log", name)))[:limit]
