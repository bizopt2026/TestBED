"""프로젝트 단위 권한: 읽기는 모든 프로젝트, 쓰기는 자기 프로젝트(소유자·멤버)만.

  - 전역 역할: viewer(읽기 전용) < editor(새 프로젝트 생성, 자기 프로젝트 쓰기) < admin(모든 프로젝트 쓰기, 사용자·권한 관리)
  - 프로젝트 역할: owner(쓰기 + 멤버 관리 + 업로드 삭제) / member(쓰기)
  - 새 프로젝트를 처음 올린 사람이 owner 가 된다.
  - 사용자 계정 도입 전에 올라온(멤버 없는) 프로젝트는 최초 업로더와 같은 이름의 계정이 있으면 그 계정을 owner 로
    자동 지정하고, 없으면 관리자만 쓸 수 있다(관리자가 소유자를 지정).
  - 계정이 하나도 없는 공개 모드에서는 제한하지 않는다.
"""
from __future__ import annotations

from datetime import datetime

from . import storage

PROJECT_ROLES = ("owner", "member")
OPEN_PROJECTS = {"교육용 샘플 - 물류센터"}  # 교육용 샘플: 편집 권한자 누구나 실습 가능


def init() -> None:
    with storage.conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS project_members (
            project TEXT, username TEXT, role TEXT, added_by TEXT, added_at TEXT, PRIMARY KEY (project, username))""")


def members(project: str) -> list[dict]:
    init()
    with storage.conn() as c:
        rows = c.execute("SELECT username, role, added_by, added_at FROM project_members WHERE project=? "
                         "ORDER BY role DESC, username", (project,)).fetchall()
    return [dict(r) for r in rows]


def projects_of(username: str) -> dict[str, str]:
    init()
    with storage.conn() as c:
        rows = c.execute("SELECT project, role FROM project_members WHERE username=?", (username,)).fetchall()
    return {r["project"]: r["role"] for r in rows}


def set_member(project: str, username: str, role: str, by: str) -> None:
    if role not in PROJECT_ROLES:
        raise ValueError("프로젝트 역할은 owner 또는 member 입니다")
    init()
    with storage.conn() as c:
        if not c.execute("SELECT 1 FROM users WHERE username=? AND active=1", (username,)).fetchone():
            raise ValueError("활성 사용자가 아닙니다")
        c.execute("INSERT OR REPLACE INTO project_members VALUES (?,?,?,?,?)",
                  (project, username, role, by, datetime.now().isoformat(timespec="seconds")))


def remove_member(project: str, username: str) -> None:
    init()
    ms = members(project)
    if any(m["username"] == username and m["role"] == "owner" for m in ms) and \
            sum(1 for m in ms if m["role"] == "owner") == 1:
        raise ValueError("마지막 소유자는 제거할 수 없습니다. 다른 소유자를 먼저 지정하세요.")
    with storage.conn() as c:
        c.execute("DELETE FROM project_members WHERE project=? AND username=?", (project, username))


def _adopt_legacy(project: str) -> None:
    """멤버가 없는 기존 프로젝트: 최초 업로더와 같은 계정이 있으면 소유자로 지정."""
    if members(project):
        return
    with storage.conn() as c:
        r = c.execute("SELECT uploader FROM uploads WHERE name=? ORDER BY created_at LIMIT 1", (project,)).fetchone()
        if r and c.execute("SELECT 1 FROM users WHERE username=? AND active=1", (r["uploader"],)).fetchone():
            c.execute("INSERT OR IGNORE INTO project_members VALUES (?,?,?,?,?)",
                      (project, r["uploader"], "owner", "system", datetime.now().isoformat(timespec="seconds")))


def project_role(user: dict, project: str) -> str | None:
    """'admin' | 'owner' | 'member' | None"""
    if user.get("role") == "admin":
        return "admin"
    if user.get("role") == "viewer":
        return None
    _adopt_legacy(project)
    r = projects_of(user["username"]).get(project)
    if r:
        return r
    return "member" if project in OPEN_PROJECTS else None


def can_write(user: dict, project: str) -> bool:
    from .package import is_ref
    if is_ref(project):          # 참조 프로젝트(남의 프로젝트를 받아 온 것)는 누구도 편집하지 않음
        return False
    return project_role(user, project) is not None


def can_manage(user: dict, project: str) -> bool:
    return project_role(user, project) in ("admin", "owner")


def project_exists(project: str) -> bool:
    with storage.conn() as c:
        return c.execute("SELECT 1 FROM uploads WHERE name=? LIMIT 1", (project,)).fetchone() is not None


def claim_new(project: str, username: str) -> None:
    """새 프로젝트를 올린 사용자를 소유자로 등록."""
    init()
    with storage.conn() as c:
        if not c.execute("SELECT 1 FROM project_members WHERE project=?", (project,)).fetchone():
            c.execute("INSERT OR IGNORE INTO project_members VALUES (?,?,?,?,?)",
                      (project, username, "owner", username, datetime.now().isoformat(timespec="seconds")))
