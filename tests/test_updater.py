"""로컬 설치판 자동 업데이트(git): 확인 → 백업 → pull → 되돌리기."""
import os
import shutil
import sqlite3
import subprocess

import pytest

from app import updater

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git 필요")


def git(cwd, *a):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *a], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repos(tmp_path):
    remote, dev, inst = tmp_path / "remote.git", tmp_path / "dev", tmp_path / "install"
    git(tmp_path, "init", "--bare", "-b", "main", str(remote))
    git(tmp_path, "clone", str(remote), str(dev))
    (dev / "VERSION").write_text("1.0.0\n")
    (dev / "requirements.txt").write_text("")
    (dev / ".gitignore").write_text("data/\n")
    git(dev, "checkout", "-b", "main"); git(dev, "add", "-A"); git(dev, "commit", "-m", "첫 버전"); git(dev, "push", "-u", "origin", "main")
    git(tmp_path, "clone", str(remote), str(inst))
    os.makedirs(inst / "data")
    with sqlite3.connect(inst / "data" / "app.db") as c:
        c.execute("CREATE TABLE t (x)"); c.execute("INSERT INTO t VALUES (42)")
    updater._cache.clear()
    return dev, inst


def test_check_apply_rollback(repos):
    dev, inst = repos
    root, db = str(inst), str(inst / "data" / "app.db")
    v = updater.version(root)
    assert v["version"] == "1.0.0" and v["git"] and v["branch"] == "main" and not v["dirty"]
    assert updater.check(root, force=True)["available"] is False
    (dev / "VERSION").write_text("1.1.0\n"); (dev / "new.txt").write_text("x")
    git(dev, "add", "-A"); git(dev, "commit", "-m", "새 기능 추가"); git(dev, "push")
    d = updater.check(root, force=True)
    assert d["available"] and d["behind"] == 1 and d["remote_version"] == "1.1.0" and d["changes"][0]["title"] == "새 기능 추가"
    r = updater.apply(root, by="admin", db_path=db, install_packages=False)
    assert r["updated"] and r["restart"] and updater.version(root)["version"] == "1.1.0"
    b = os.listdir(inst / "data" / "backups")
    assert len(b) == 1 and sqlite3.connect(inst / "data" / "backups" / b[0]).execute("SELECT x FROM t").fetchone()[0] == 42
    assert updater.last_update(root)["by"] == "admin"
    assert updater.check(root, force=True)["available"] is False
    updater.rollback(root, by="admin")
    assert updater.version(root)["version"] == "1.0.0"
    assert updater.check(root, force=True)["available"] is True   # 다음 업데이트 때 다시 최신으로


def test_dirty_and_not_git(repos, tmp_path):
    dev, inst = repos
    (inst / "VERSION").write_text("수정함\n")
    with pytest.raises(updater.UpdateError, match="직접 수정"):
        updater.apply(str(inst), install_packages=False, db_path=str(inst / "data" / "app.db"))
    plain = tmp_path / "zip"
    plain.mkdir()
    (plain / "VERSION").write_text("1.0.0")
    d = updater.check(str(plain), force=True)
    assert d["git"] is False and "git clone" in d["error"]


def test_admin_api(monkeypatch):
    from fastapi.testclient import TestClient

    from app import storage
    from app.main import app
    storage.DB_PATH = os.path.join(__import__("tempfile").mkdtemp(), "x.db"); storage.init()
    monkeypatch.setattr(updater, "check", lambda force=False: {"available": True, "behind": 2, "changes": [], "error": None})
    monkeypatch.setattr(updater, "apply", lambda by="": {"updated": True, "restart": True, "from": "a", "to": "b"})
    c = TestClient(app)
    c.headers.update({"X-Requested-With": "fetch"})
    assert c.get("/api/config").json()["version"]
    assert c.get("/api/admin/update").json()["behind"] == 2
    r = c.post("/api/admin/update").json()
    assert r["updated"] and r["restarting"] is False   # 시작 스크립트 밖에서는 자동 재시작 안 함
