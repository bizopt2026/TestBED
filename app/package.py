"""PMS 프로젝트 패키지(.pms) — 파일·복사 붙여넣기·공유 코드·서버 게시가 함께 쓰는 공통 그릇 (설계 4장).

project.pms (zip)
  manifest.json   형식·버전, 프로젝트 ID(pid)·이름, 판, Data Date, 내보낸 사람·시각, 파일별 SHA-256
  schedule.xer    공정표 원본 (MS Project는 변환된 XER)
  settings.json   계산 옵션·품질 기준·상태 기준
  records.json    리스크·제약·약속·코멘트·월간 점검 기록
  summary.json    요약(준공·여유·건전성·마일스톤) — 받는 쪽이 계산 전에 바로 표시
  attachments/    (서버 게시에만) 현장 사진

받은 패키지는 '참조 프로젝트'(읽기 전용, 출처 표시)로 들어온다. 편집하려면 '내 프로젝트로 복제'.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import uuid
import zipfile
from datetime import datetime

from . import storage

FORMAT = "pms-package"
FORMAT_VERSION = 1
TEXT_PREFIX = "PMS1:"
TEXT_MAX = 1024 * 1024           # 붙여넣기 텍스트로 보낼 수 있는 패키지 크기(압축 후)
REF_SUFFIX = " · 참조"
RECORD_KINDS = ("risk", "constraint", "commit", "comment")


class PackageError(ValueError):
    pass


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def project_pid(name: str) -> str:
    """프로젝트 고유 ID (처음 필요할 때 만들고 계속 유지)."""
    pid = storage.setting(name, "pid")
    if not pid:
        pid = uuid.uuid4().hex
        storage.set_setting(name, "pid", pid)
    return pid


def ref_meta(name: str) -> dict | None:
    return storage.setting(name, "ref_meta") or None


def is_ref(name: str | None) -> bool:
    return bool(name and ref_meta(name))


def _version_of(uid: str, name: str) -> int:
    """이 업데이트가 프로젝트 안에서 몇 번째 판인지(Data Date 순)."""
    hist = storage.history(name)
    return next((i + 1 for i, h in enumerate(hist) if h["id"] == uid), len(hist))


def build(uid: str, by: str = "", attachments: bool = False, version: int | None = None) -> tuple[bytes, dict]:
    from . import services, workflow
    d = storage.get_raw(uid)
    if not d:
        raise PackageError("없는 업데이트입니다")
    r = services.result(uid)
    name = r["name"]
    meta = ref_meta(name) or {}
    pid = meta.get("pid") or project_pid(name)
    files: dict[str, bytes] = {"schedule.xer": d["raw"]}
    files["settings.json"] = json.dumps({
        "schedule_options": services.sched_options(name),
        "metric_overrides": storage.setting(name, "metric_overrides", {}) or {},
        "status_thresholds": storage.setting(name, "status_thresholds", {}) or {},
    }, ensure_ascii=False).encode()
    rec = {k: [{kk: vv for kk, vv in x.items() if kk != "scope"} for x in storage.rec_list(k, name)] for k in RECORD_KINDS}
    rec["review"] = workflow.signoffs(uid)
    files["records.json"] = json.dumps(rec, ensure_ascii=False).encode()
    acts = r["activities"]
    files["summary.json"] = json.dumps({
        "name": meta.get("project") or name, "data_date": r["data_date"], "finish": r["finish"], "must_finish": r.get("must_finish"),
        "progress": r["summary"]["progress_pct"], "activities": len(acts), "health": services.health_score(uid),
        "negative_float": sum(1 for a in acts if a["status_code"] != "TK_Complete" and a["tf"] is not None and a["tf"] < 0),
        "milestones": [{"code": a["code"], "name": a["name"], "finish": a["finish"], "done": a["status_code"] == "TK_Complete"} for a in acts if a.get("milestone")][:20],
    }, ensure_ascii=False).encode()
    if attachments:
        for f in storage.file_list(name):
            if f["ref"] and not f["ref"].startswith(("final:", "logo")) and f["mime"].startswith("image/"):
                ff = storage.file_get(f["id"])
                files[f"attachments/{f['ref']}__{f['id']}.jpg"] = ff["data"]
    manifest = {
        "format": FORMAT, "format_version": FORMAT_VERSION, "pid": pid, "project": meta.get("project") or name,
        "version": version or _version_of(uid, name), "proj_id": d.get("proj_id"), "data_date": r["data_date"], "finish": r["finish"],
        "exported_at": datetime.now().isoformat(timespec="seconds"), "exported_by": by, "source_filename": d.get("filename"),
        "files": {k: _sha(v) for k, v in files.items()},
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue(), manifest


def read(data: bytes) -> tuple[dict, dict[str, bytes]]:
    """패키지를 열고 형식·해시를 검사한다."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        manifest = json.loads(z.read("manifest.json"))
    except (zipfile.BadZipFile, KeyError, ValueError):
        raise PackageError("PMS 패키지(.pms) 파일이 아니거나 손상되었습니다")
    if manifest.get("format") != FORMAT:
        raise PackageError("PMS 패키지 형식이 아닙니다")
    if int(manifest.get("format_version", 0)) > FORMAT_VERSION:
        raise PackageError("더 새 버전의 PMS에서 만든 패키지입니다. 프로그램을 업데이트하세요")
    files = {}
    for k, h in (manifest.get("files") or {}).items():
        try:
            b = z.read(k)
        except KeyError:
            raise PackageError(f"패키지에 {k}가 없습니다")
        if _sha(b) != h:
            raise PackageError(f"{k} 내용이 손상되었거나 바뀌었습니다 (해시 불일치)")
        files[k] = b
    if "schedule.xer" not in files:
        raise PackageError("패키지에 공정표가 없습니다")
    return manifest, files


def to_text(data: bytes) -> str:
    if len(data) > TEXT_MAX:
        raise PackageError(f"프로젝트가 커서({len(data) // 1024}KB) 붙여넣기로 보낼 수 없습니다. .pms 파일이나 공유 코드로 보내세요")
    return TEXT_PREFIX + base64.urlsafe_b64encode(data).decode()


def from_text(text: str) -> bytes:
    t = "".join((text or "").split())
    if not t.startswith(TEXT_PREFIX):
        raise PackageError("PMS 붙여넣기 텍스트가 아닙니다 (PMS1: 로 시작해야 합니다)")
    try:
        return base64.urlsafe_b64decode(t[len(TEXT_PREFIX):].encode())
    except (ValueError, TypeError):
        raise PackageError("붙여넣기 텍스트가 잘렸거나 손상되었습니다")


def rename_xer(raw: bytes, proj_id: str | None, new_name: str) -> bytes:
    from .xer_parser import decode, header_line, parse_tables, table_fields, write_xer
    text = decode(raw)
    tables = parse_tables(text)
    for p in tables.get("PROJECT", []):
        if proj_id is None or p.get("proj_id") == proj_id:
            p["proj_short_name"] = new_name
    return write_xer(tables, header_line(text), table_fields(text)).encode("utf-8")


def _analyze(raw: bytes, proj_id: str | None, name: str, options: dict) -> tuple[str, dict]:
    from .analysis import analyze
    from .schedule import Schedule, list_projects
    from .xer_parser import parse_xer
    tables = parse_xer(raw)
    projs = list_projects(tables)
    pj = next((p for p in projs if p["proj_id"] == proj_id), projs[0] if projs else None)
    if not pj:
        raise PackageError("공정표에 프로젝트가 없습니다")
    res = analyze(Schedule(tables, pj["proj_id"], options))
    res["name"] = name
    return pj["proj_id"], res


def import_package(data: bytes, user: str = "", source: str = "file", extra_meta: dict | None = None) -> dict:
    """패키지를 '참조 프로젝트'로 가져온다. 같은 pid 의 같은 판은 다시 만들지 않는다."""
    from . import access, auth as auth_mod, services
    manifest, files = read(data)
    pid, ver = manifest["pid"], int(manifest.get("version") or 1)
    # 내 프로젝트(원본)라면 참조로 가져오지 않음
    for p in storage.latest_by_project():
        if storage.setting(p["name"], "pid") == pid and not is_ref(p["name"]):
            raise PackageError(f"이 프로젝트의 원본('{p['name']}')이 이미 이 PMS에 있습니다")
    existing = next((p["name"] for p in storage.latest_by_project() if (ref_meta(p["name"]) or {}).get("pid") == pid), None)
    name = existing or (manifest["project"] + REF_SUFFIX)
    if not existing and access.project_exists(name):
        name = f"{manifest['project']}{REF_SUFFIX} {pid[:4]}"
    for h in storage.history(name):
        if (storage.get_extra(h["id"], "ref_version") or {}).get("version") == ver:
            return {"uid": h["id"], "name": name, "version": ver, "duplicate": True}
    settings = json.loads(files.get("settings.json", b"{}") or b"{}")
    opts = settings.get("schedule_options") or {}
    raw = rename_xer(files["schedule.xer"], manifest.get("proj_id"), name)
    proj_id, res = _analyze(raw, manifest.get("proj_id"), name, opts)
    uid = storage.save(manifest.get("source_filename") or "project.xer", proj_id, name, manifest.get("exported_by") or "참조",
                       f"참조 v{ver} · {manifest.get('exported_by') or ''}", raw, res)
    storage.set_extra(uid, "ref_version", {"version": ver, "exported_at": manifest.get("exported_at")})
    storage.set_setting(name, "schedule_options", opts)
    for k in ("metric_overrides", "status_thresholds"):
        if settings.get(k):
            storage.set_setting(name, k, settings[k])
    storage.set_setting(name, "ref_meta", {"pid": pid, "project": manifest["project"], "source": source, "publisher": manifest.get("exported_by"),
                                           "version": ver, "exported_at": manifest.get("exported_at"), "imported_at": datetime.now().isoformat(timespec="seconds"),
                                           "imported_by": user, **(extra_meta or {})})
    # 협업 기록: 최신 판 기준으로 통째로 바꿈 (참조 프로젝트는 읽기 전용이라 충돌 없음)
    rec = json.loads(files.get("records.json", b"{}") or b"{}")
    for k in RECORD_KINDS:
        for x in storage.rec_list(k, name):
            storage.rec_del(k, x["id"])
        for x in rec.get(k) or []:
            data_ = {kk: vv for kk, vv in x.items() if kk not in ("id", "author", "created_at", "updated_at")}
            storage.rec_put(k, name, data_, x.get("author") or "", rid=x.get("id"))
    if rec.get("review", {}).get("steps"):
        storage.rec_put("review", name, rec["review"], user, rid=uid)
    for k, b in files.items():   # 서버 게시에서 받은 현장 사진
        if k.startswith("attachments/"):
            ref = k.split("/", 1)[1].split("__")[0]
            storage.file_put(name, ref, "image/jpeg", b, manifest.get("exported_by") or "")
    if auth_mod.users_exist() and user and not access.members(name):
        access.claim_new(name, user)      # 지울 수 있게 가져온 사람을 소유자로 (편집은 참조라 불가)
    services._tables.cache_clear()
    return {"uid": uid, "name": name, "version": ver, "duplicate": False}


def clone(name: str, new_name: str, user: str = "") -> dict:
    """참조 프로젝트(또는 아무 프로젝트)의 최신 판을 '내 프로젝트'로 복제한다."""
    from . import access, auth as auth_mod, services
    new_name = (new_name or "").strip()
    if not new_name or len(new_name) > 80:
        raise PackageError("새 프로젝트 이름을 입력하세요")
    if access.project_exists(new_name):
        raise PackageError(f"'{new_name}' 프로젝트가 이미 있습니다. 다른 이름을 쓰세요")
    hist = storage.history(name)
    if not hist:
        raise PackageError("없는 프로젝트입니다")
    last = storage.get_raw(hist[-1]["id"])
    opts = services.sched_options(name)
    raw = rename_xer(last["raw"], last.get("proj_id"), new_name)
    proj_id, res = _analyze(raw, last.get("proj_id"), new_name, opts)
    uid = storage.save(last.get("filename") or "project.xer", proj_id, new_name, user or "복제", f"복제: {name}", raw, res)
    storage.set_setting(new_name, "schedule_options", opts)
    for k in RECORD_KINDS[:3]:   # 리스크·제약·약속은 복사, 코멘트는 원본 대화라 복사하지 않음
        for x in storage.rec_list(k, name):
            storage.rec_put(k, new_name, {kk: vv for kk, vv in x.items() if kk not in ("id", "scope", "author", "created_at", "updated_at")}, user)
    if auth_mod.users_exist() and user:
        access.claim_new(new_name, user)
    project_pid(new_name)
    return {"uid": uid, "name": new_name}
