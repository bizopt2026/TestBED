"""AI 연결 계층: 서버에 설치된 Claude CLI(`claude -p`)를 호출한다. API 키를 쓰지 않는다.

보안 설계
  - `--tools ""`            : 명령 실행·파일 읽기/쓰기 등 CLI 기본 도구를 모두 끈다
  - `--strict-mcp-config`   : 앱이 지정한 MCP 서버(읽기 전용 공정 조회 도구)만 사용
  - `--setting-sources ""`  : 서버의 사용자/프로젝트 설정·훅을 불러오지 않음
  - 빈 임시 디렉터리에서 실행, 세션 기록 저장 안 함, 시간 제한·동시 실행 수 제한

환경변수
  AI_PROVIDER     cli(기본) | off
  CLAUDE_BIN      claude 실행 파일 경로 (기본: PATH 에서 검색)
  AI_MODEL        모델 별칭/ID (비우면 CLI 기본값)
  AI_MODEL_BULK   대량 분류·추출용 모델 (비우면 AI_MODEL)
  AI_TIMEOUT      호출당 제한 시간(초, 기본 300)
  AI_MAX_CONCURRENCY  동시 실행 수 (기본 2)
  AI_MAX_BUDGET_USD   호출당 최대 비용 (선택)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Callable

PROVIDER = (os.environ.get("AI_PROVIDER") or "cli").lower()
CLAUDE_BIN = os.environ.get("CLAUDE_BIN") or shutil.which("claude") or "claude"
MODEL = os.environ.get("AI_MODEL") or ""
MODEL_BULK = os.environ.get("AI_MODEL_BULK") or MODEL
TIMEOUT = int(os.environ.get("AI_TIMEOUT", "300"))
BUDGET = os.environ.get("AI_MAX_BUDGET_USD", "")
_sem = threading.BoundedSemaphore(int(os.environ.get("AI_MAX_CONCURRENCY", "2")))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_runner: Callable[[list[str], str], dict] | None = None  # 테스트용 가짜 실행기


class AIUnavailable(RuntimeError):
    pass


class AIRefused(RuntimeError):
    pass


class AIFailed(RuntimeError):
    pass


def set_runner(fn) -> None:
    """테스트용: fn(args, stdin_text) -> CLI JSON 결과(dict). None 이면 해제."""
    global _runner
    _runner = fn


def available() -> bool:
    if _runner is not None:
        return True
    if PROVIDER == "off":
        return False
    return bool(shutil.which(CLAUDE_BIN) or os.path.exists(CLAUDE_BIN))


def status() -> dict:
    return {"enabled": available(), "provider": "Claude CLI" if PROVIDER != "off" else "off",
            "model": MODEL or "CLI 기본값", "model_bulk": MODEL_BULK or "CLI 기본값", "bin": CLAUDE_BIN}


def _exec(args: list[str], prompt: str) -> dict:
    if _runner is not None:
        return _runner(args, prompt)
    if not available():
        raise AIUnavailable("AI가 설정되지 않았습니다 (서버에 Claude CLI 설치·로그인 필요)")
    if not _sem.acquire(timeout=60):
        raise AIFailed("AI 요청이 많아 대기 시간이 초과되었습니다. 잠시 후 다시 시도하세요.")
    try:
        with tempfile.TemporaryDirectory(prefix="ai-") as cwd:
            try:
                p = subprocess.run([CLAUDE_BIN, *args], input=prompt, capture_output=True, text=True,
                                   timeout=TIMEOUT, cwd=cwd)
            except subprocess.TimeoutExpired:
                raise AIFailed(f"AI 응답 시간({TIMEOUT}초)을 초과했습니다")
            except FileNotFoundError:
                raise AIUnavailable("Claude CLI 실행 파일을 찾을 수 없습니다")
    finally:
        _sem.release()
    out = p.stdout.strip()
    try:
        data = json.loads(out.splitlines()[-1] if out else "{}")
    except json.JSONDecodeError:
        raise AIFailed(f"AI 응답을 해석할 수 없습니다: {(p.stderr or out)[:300]}")
    if p.returncode != 0 and not data:
        raise AIFailed(f"Claude CLI 오류: {(p.stderr or out)[:300]}")
    return data


def _base_args(system: str, effort: str, model: str) -> list[str]:
    args = ["-p", "--output-format", "json", "--no-session-persistence", "--tools", "",
            "--strict-mcp-config", "--setting-sources", "", "--system-prompt", system]
    if effort:
        args += ["--effort", effort]
    if model:
        args += ["--model", model]
    if BUDGET:
        args += ["--max-budget-usd", BUDGET]
    return args


def _check(data: dict) -> None:
    if data.get("stop_reason") == "refusal" or data.get("subtype") == "refusal":
        raise AIRefused("AI가 이 요청에 답변하지 않았습니다. 질문을 바꿔 다시 시도하세요.")
    if data.get("is_error") or (data.get("subtype") and data.get("subtype") != "success"):
        msg = data.get("result") or data.get("subtype") or "알 수 없는 오류"
        raise AIFailed(f"AI 처리 실패: {str(msg)[:300]}")


def usage_of(data: dict) -> dict:
    u = data.get("usage") or {}
    return {"in": (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0)
            + (u.get("cache_creation_input_tokens") or 0),
            "out": u.get("output_tokens") or 0, "cost": data.get("total_cost_usd") or 0}


def complete(system: str, prompt: str, effort: str = "medium", max_tokens: int = 0,
             model: str | None = None) -> tuple[str, dict]:
    data = _exec(_base_args(system, effort, model if model is not None else MODEL), prompt)
    _check(data)
    return str(data.get("result") or "").strip(), usage_of(data)


def structured(system: str, prompt: str, schema: dict, effort: str = "low", max_tokens: int = 0,
               model: str | None = None) -> tuple[Any, dict]:
    args = _base_args(system, effort, model if model is not None else MODEL_BULK)
    args += ["--json-schema", json.dumps(schema, ensure_ascii=False)]
    data = _exec(args, prompt)
    _check(data)
    out = data.get("structured_output")
    if out is None:
        try:
            out = json.loads(data.get("result") or "")
        except (TypeError, json.JSONDecodeError):
            raise AIFailed("AI가 형식에 맞는 결과를 돌려주지 않았습니다")
    return out, usage_of(data)


def run_tools(system: str, prompt: str, upload_id: str, effort: str = "medium") -> dict:
    """앱의 읽기 전용 MCP 도구(app.mcp_server)를 붙여 대화형 질의를 실행."""
    from . import storage
    env = {"DB_PATH": os.path.abspath(storage.DB_PATH), "PYTHONPATH": ROOT}
    cfg = {"mcpServers": {"sched": {"type": "stdio", "command": sys.executable,
                                    "args": ["-m", "app.mcp_server", upload_id], "env": env}}}
    args = _base_args(system, effort, MODEL) + ["--mcp-config", json.dumps(cfg), "--allowedTools", "mcp__sched"]
    t0 = time.time()
    data = _exec(args, prompt)
    _check(data)
    return {"answer": str(data.get("result") or "").strip(), "usage": usage_of(data),
            "seconds": round(time.time() - t0, 1), "turns": data.get("num_turns"),
            "denied": [d.get("tool_name") for d in data.get("permission_denials") or []]}
