"""로컬 설치판 버전 관리·자동 업데이트 (git 기반).

- 설치 폴더가 `git clone`으로 만든 저장소일 때 동작합니다(ZIP 설치는 업데이트 확인만 '불가'로 표시).
- 확인: `git fetch` 후 현재 브랜치가 원격보다 몇 커밋 뒤인지, 바뀐 내용(커밋 제목)을 보여 줍니다.
- 적용: 데이터베이스 백업 → `git pull --ff-only` → requirements.txt가 바뀌었으면 패키지 설치 → 재시작 요청.
- 되돌리기: 직전 업데이트 전 커밋으로 코드를 되돌립니다(데이터는 그대로, 백업은 data/backups 에 보관).

명령줄:  python -m app.updater check | apply | rollback | version
  check 는 업데이트가 있으면 종료 코드 10, 없으면 0, 확인 불가면 1 을 돌려줍니다(시작 스크립트용).
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RESTART_CODE = 3          # 시작 스크립트가 이 종료 코드를 받으면 서버를 다시 띄운다
KEEP_BACKUPS = 10
_lock = threading.Lock()
_cache: dict = {}


def _data_dir(root: str) -> str:
    from . import storage
    return os.path.dirname(os.path.abspath(storage.DB_PATH)) if root == ROOT else os.path.join(root, "data")


def _git(root: str, *args: str, timeout: int = 30) -> str:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never", "LC_ALL": "C"}
    r = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=timeout, env=env)
    if r.returncode != 0:
        raise UpdateError((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else f"git {args[0]} 실패")
    return r.stdout.strip()


class UpdateError(Exception):
    pass


def _read_version(root: str) -> str:
    try:
        return open(os.path.join(root, "VERSION"), encoding="utf-8").read().strip()
    except OSError:
        return "개발판"


def is_repo(root: str = ROOT) -> bool:
    return shutil.which("git") is not None and os.path.isdir(os.path.join(root, ".git"))


def version(root: str = ROOT) -> dict:
    out = {"version": _read_version(root), "commit": None, "branch": None, "date": None, "git": is_repo(root), "dirty": False}
    if out["git"]:
        try:
            out["commit"] = _git(root, "rev-parse", "--short", "HEAD")
            out["branch"] = _git(root, "rev-parse", "--abbrev-ref", "HEAD")
            out["date"] = _git(root, "log", "-1", "--format=%cs")
            out["dirty"] = bool(_git(root, "status", "--porcelain", "--untracked-files=no"))
        except (UpdateError, OSError, subprocess.TimeoutExpired):
            pass
    return out


def _upstream(root: str) -> str:
    try:
        return _git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    except UpdateError:
        return "origin/" + _git(root, "rev-parse", "--abbrev-ref", "HEAD")


def check(root: str = ROOT, max_age: int = 600, force: bool = False) -> dict:
    """원격 저장소와 비교. 결과는 max_age 초 동안 캐시."""
    key = root
    c = _cache.get(key)
    if c and not force and time.time() - c["_at"] < max_age:
        return c["data"]
    v = version(root)
    data = {**v, "available": False, "behind": 0, "changes": [], "remote_version": None, "error": None,
            "checked_at": datetime.now().isoformat(timespec="seconds"), "last": last_update(root)}
    if not v["git"]:
        data["error"] = "git 저장소로 설치되지 않아 자동 업데이트를 쓸 수 없습니다 (git clone 으로 다시 설치하세요)"
    else:
        try:
            up = _upstream(root)
            remote, branch = up.split("/", 1)
            _git(root, "fetch", "--quiet", remote, branch, timeout=60)
            data["upstream"] = up
            data["behind"] = int(_git(root, "rev-list", "--count", f"HEAD..{up}") or 0)
            data["ahead"] = int(_git(root, "rev-list", "--count", f"{up}..HEAD") or 0)
            if data["behind"]:
                log = _git(root, "log", "--format=%h%x09%cs%x09%s", f"HEAD..{up}", "-n", "30")
                data["changes"] = [dict(zip(("commit", "date", "title"), line.split("\t", 2))) for line in log.splitlines() if line]
                try:
                    data["remote_version"] = _git(root, "show", f"{up}:VERSION").strip()
                except UpdateError:
                    pass
            data["available"] = data["behind"] > 0
        except (UpdateError, OSError, subprocess.TimeoutExpired) as e:
            data["error"] = f"업데이트 서버(GitHub)에 연결하지 못했습니다: {e}"
    _cache[key] = {"_at": time.time(), "data": data}
    return data


def backup_db(root: str = ROOT, db_path: str | None = None) -> str | None:
    from . import storage
    src = db_path or (storage.DB_PATH if root == ROOT else os.path.join(root, "data", "app.db"))
    if not os.path.exists(src):
        return None
    bdir = os.path.join(os.path.dirname(os.path.abspath(src)), "backups")
    os.makedirs(bdir, exist_ok=True)
    dst = os.path.join(bdir, f"app-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db")
    with sqlite3.connect(src) as s, sqlite3.connect(dst) as d:   # 사용 중에도 안전한 온라인 백업
        s.backup(d)
    olds = sorted(f for f in os.listdir(bdir) if f.startswith("app-") and f.endswith(".db"))
    for f in olds[:-KEEP_BACKUPS]:
        os.remove(os.path.join(bdir, f))
    return dst


def _log_path(root: str) -> str:
    return os.path.join(_data_dir(root), "update_log.json")


def last_update(root: str = ROOT) -> dict | None:
    try:
        xs = json.load(open(_log_path(root), encoding="utf-8"))
        return xs[-1] if xs else None
    except (OSError, ValueError):
        return None


def _append_log(root: str, entry: dict) -> None:
    p = _log_path(root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    try:
        xs = json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        xs = []
    xs.append(entry)
    json.dump(xs[-50:], open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def _pip_install(root: str) -> None:
    r = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", os.path.join(root, "requirements.txt")],
                       cwd=root, capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        raise UpdateError("패키지 설치 실패: " + (r.stderr.strip().splitlines() or ["알 수 없음"])[-1])


def apply(root: str = ROOT, by: str = "", db_path: str | None = None, install_packages: bool = True) -> dict:
    """업데이트 적용. 성공하면 재시작이 필요하다."""
    if not _lock.acquire(blocking=False):
        raise UpdateError("이미 업데이트 중입니다")
    try:
        v = version(root)
        if not v["git"]:
            raise UpdateError("git 저장소로 설치되지 않아 자동 업데이트를 쓸 수 없습니다")
        if v["dirty"]:
            raise UpdateError("설치 폴더의 프로그램 파일이 직접 수정되어 있어 업데이트를 멈췄습니다 (git status 확인)")
        before = _git(root, "rev-parse", "HEAD")
        backup = backup_db(root, db_path)
        up = _upstream(root)
        remote, branch = up.split("/", 1)
        _git(root, "pull", "--ff-only", "--quiet", remote, branch, timeout=120)
        after = _git(root, "rev-parse", "HEAD")
        changed = _git(root, "diff", "--name-only", before, after).splitlines() if before != after else []
        if install_packages and "requirements.txt" in changed:
            _pip_install(root)
        entry = {"at": datetime.now().isoformat(timespec="seconds"), "by": by, "from": before[:7], "to": after[:7],
                 "from_full": before, "version": _read_version(root), "files": len(changed), "backup": os.path.basename(backup) if backup else None}
        if before != after:
            _append_log(root, entry)
        _cache.pop(root, None)
        return {**entry, "updated": before != after, "restart": before != after}
    finally:
        _lock.release()


def rollback(root: str = ROOT, by: str = "") -> dict:
    """직전 업데이트 전 커밋으로 되돌린다. 다음 업데이트 때 다시 최신으로 올라간다."""
    last = last_update(root)
    if not last or not last.get("from_full"):
        raise UpdateError("되돌릴 업데이트 기록이 없습니다")
    if version(root)["dirty"]:
        raise UpdateError("설치 폴더에 수정된 파일이 있어 되돌릴 수 없습니다")
    cur = _git(root, "rev-parse", "HEAD")
    _git(root, "reset", "--hard", "--quiet", last["from_full"])
    _append_log(root, {"at": datetime.now().isoformat(timespec="seconds"), "by": by, "from": cur[:7], "to": last["from_full"][:7],
                       "from_full": cur, "version": _read_version(root), "rollback": True})
    _cache.pop(root, None)
    return {"to": last["from_full"][:7], "restart": True}


def restart_later(delay: float = 1.0) -> bool:
    """시작 스크립트(APP_LAUNCHER=1)로 실행 중이면 잠시 뒤 종료 코드 3으로 끝내 다시 띄우게 한다."""
    if os.environ.get("APP_LAUNCHER") != "1":
        return False
    threading.Thread(target=lambda: (time.sleep(delay), os._exit(RESTART_CODE)), daemon=True).start()
    return True


def _main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "version"
    if cmd == "version":
        v = version()
        print(f"버전 {v['version']} ({v['commit'] or '-'}, {v['branch'] or '-'}, {v['date'] or '-'})")
        return 0
    if cmd == "check":
        d = check(force=True)
        if d["error"]:
            print("업데이트 확인 건너뜀:", d["error"])
            return 1
        if not d["available"]:
            print(f"최신 버전입니다 ({d['version']}, {d['commit']})")
            return 0
        print(f"새 업데이트 {d['behind']}건이 있습니다 ({d['version']} → {d['remote_version'] or '새 버전'})")
        for c in d["changes"][:10]:
            print(f"  · {c['date']} {c['title']}")
        return 10
    if cmd == "apply":
        try:
            r = apply(by="시작 스크립트")
        except (UpdateError, subprocess.TimeoutExpired) as e:
            print("[!] 업데이트 실패:", e)
            return 1
        print(f"업데이트 완료: {r['from']} → {r['to']} (데이터 백업: {r['backup'] or '없음'})" if r["updated"] else "이미 최신입니다")
        return 0
    if cmd == "rollback":
        try:
            r = rollback(by="명령줄")
        except UpdateError as e:
            print("[!]", e)
            return 1
        print(f"{r['to']} 로 되돌렸습니다. 프로그램을 다시 시작하세요.")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
