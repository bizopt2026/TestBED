"""사용자 계정, 역할 권한, 세션, 감사 로그.

- 사용자 계정이 하나도 없으면 기존 방식(APP_TOKEN 또는 공개)으로 동작한다.
- 관리자 계정은 환경변수(ADMIN_USERNAME/ADMIN_PASSWORD) 또는 CLI 로만 만든다
  (네트워크에서 첫 관리자를 '선점'하는 문제 방지).
      python -m app.auth create-admin <아이디>
- 비밀번호: scrypt(n=2^14, r=8, p=1) + 16바이트 salt
- 세션: 무작위 토큰(쿠키, HttpOnly + SameSite=Strict), DB 에는 SHA-256 해시만 저장
- 로그인 실패 5회 시 10분 잠금
역할: viewer(조회·What-if 계산) < editor(업로드·AI·시나리오·레코드 편집) < admin(삭제·사용자·설정)
"""
from __future__ import annotations

import getpass
import hashlib
import hmac
import os
import secrets
import sys
import time
from datetime import datetime

from . import storage

ROLES = {"viewer": 1, "editor": 2, "admin": 3}
SESSION_HOURS = float(os.environ.get("SESSION_HOURS", "12"))
COOKIE = "sched_session"
_fails: dict[str, list[float]] = {}


def hash_pw(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${h.hex()}"


def verify_pw(pw: str, stored: str) -> bool:
    try:
        _, salt, h = stored.split("$")
        got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1, dklen=32)
        return hmac.compare_digest(got.hex(), h)
    except (ValueError, TypeError):
        return False


_WEAK = {"1234567890", "0123456789", "qwertyuiop", "password12", "passw0rd12", "abcdefghij", "1q2w3e4r5t", "asdfghjkl1"}


def validate_pw(pw: str) -> None:
    pw = pw or ""
    if len(pw) < 10:
        raise ValueError("비밀번호는 10자 이상이어야 합니다")
    kinds = sum([any(ch.isalpha() for ch in pw), any(ch.isdigit() for ch in pw), any(not ch.isalnum() for ch in pw)])
    if kinds < 2 or len(set(pw)) < 4 or pw.lower() in _WEAK:
        raise ValueError("비밀번호는 영문·숫자·기호 중 2가지 이상을 섞고, 같은 글자 반복이나 흔한 비밀번호는 쓸 수 없습니다")


def users_exist() -> bool:
    with storage.conn() as c:
        return c.execute("SELECT COUNT(*) FROM users WHERE active=1").fetchone()[0] > 0


def create_user(username: str, pw: str, role: str) -> None:
    username = (username or "").strip()
    if not username or len(username) > 40:
        raise ValueError("아이디를 확인하세요")
    if role not in ROLES:
        raise ValueError("역할 오류")
    validate_pw(pw)
    with storage.conn() as c:
        if c.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            raise ValueError("이미 있는 아이디입니다")
        c.execute("INSERT INTO users VALUES (?,?,?,?,?,?)",
                  (username, hash_pw(pw), role, 1, datetime.now().isoformat(timespec="seconds"), None))


def update_user(username: str, role: str | None = None, active: bool | None = None, pw: str | None = None) -> None:
    with storage.conn() as c:
        if not c.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            raise KeyError(username)
        if role:
            if role not in ROLES:
                raise ValueError("역할 오류")
            c.execute("UPDATE users SET role=? WHERE username=?", (role, username))
        if active is not None:
            c.execute("UPDATE users SET active=? WHERE username=?", (1 if active else 0, username))
            if not active:
                c.execute("DELETE FROM sessions WHERE username=?", (username,))
        if pw:
            validate_pw(pw)
            c.execute("UPDATE users SET pw_hash=? WHERE username=?", (hash_pw(pw), username))
            c.execute("DELETE FROM sessions WHERE username=?", (username,))


def list_users() -> list[dict]:
    with storage.conn() as c:
        rows = c.execute("SELECT username, role, active, created_at, last_login FROM users ORDER BY username").fetchall()
    return [dict(r) for r in rows]


def check_password(username: str, pw: str, ip: str | None = None) -> bool:
    """비밀번호 확인. ip를 주면 로그인과 같은 실패 잠금(5회/10분)을 적용한다(대시보드 연결 등)."""
    now = time.time()
    key = f"{ip}|{username}"
    if ip is not None:
        recent = [t for t in _fails.get(key, []) if now - t < 600]
        if len(recent) >= 5:
            raise PermissionError("로그인 실패가 많아 이 PC에서 10분간 잠겼습니다")
    with storage.conn() as c:
        r = c.execute("SELECT pw_hash, active FROM users WHERE username=?", (username,)).fetchone()
    ok = bool(r and r["active"] and verify_pw(pw, r["pw_hash"]))
    if ip is not None:
        if ok:
            _fails.pop(key, None)
        else:
            _fails[key] = [t for t in _fails.get(key, []) if now - t < 600] + [now]
    return ok


def login(username: str, pw: str, ip: str = "") -> str:
    """실패 잠금은 '접속 주소 + 아이디' 기준 — 남이 아이디만 알고 계정을 잠글 수 없게."""
    now = time.time()
    key = f"{ip}|{username}"
    recent = [t for t in _fails.get(key, []) if now - t < 600]
    if len(recent) >= 5:
        raise PermissionError("로그인 실패가 많아 이 PC에서 10분간 잠겼습니다")
    with storage.conn() as c:
        r = c.execute("SELECT pw_hash, active FROM users WHERE username=?", (username,)).fetchone()
    if not r or not r["active"] or not verify_pw(pw, r["pw_hash"]):
        _fails[key] = recent + [now]
        raise PermissionError("아이디 또는 비밀번호가 올바르지 않습니다")
    _fails.pop(key, None)
    token = secrets.token_urlsafe(32)
    with storage.conn() as c:
        c.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        c.execute("INSERT INTO sessions VALUES (?,?,?)",
                  (hashlib.sha256(token.encode()).hexdigest(), username, now + SESSION_HOURS * 3600))
        c.execute("UPDATE users SET last_login=? WHERE username=?", (datetime.now().isoformat(timespec="seconds"), username))
    return token


def logout(token: str) -> None:
    with storage.conn() as c:
        c.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))


def session_user(token: str | None) -> dict | None:
    if not token:
        return None
    th = hashlib.sha256(token.encode()).hexdigest()
    now = time.time()
    with storage.conn() as c:
        r = c.execute("""SELECT u.username, u.role FROM sessions s JOIN users u ON s.username=u.username
                         WHERE s.token_hash=? AND s.expires_at>? AND u.active=1""", (th, now)).fetchone()
        if r:  # 슬라이딩 만료
            c.execute("UPDATE sessions SET expires_at=? WHERE token_hash=?", (now + SESSION_HOURS * 3600, th))
    return dict(r) if r else None


def bootstrap_from_env() -> None:
    u, p = os.environ.get("ADMIN_USERNAME"), os.environ.get("ADMIN_PASSWORD")
    if u and p and not users_exist():
        create_user(u, p, "admin")


if __name__ == "__main__":  # python -m app.auth create-admin <아이디>
    storage.init()
    if len(sys.argv) >= 3 and sys.argv[1] == "create-admin":
        pw = getpass.getpass("비밀번호(10자 이상): ")
        create_user(sys.argv[2], pw, "admin")
        print("관리자 계정을 만들었습니다.")
    else:
        print("사용법: python -m app.auth create-admin <아이디>")
