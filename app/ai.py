"""Claude API 연결 계층.

환경변수
  AI_PROVIDER   anthropic(기본) | bedrock | off
  AI_MODEL      대화형·보고서 모델 (기본 claude-opus-5-5)
  AI_MODEL_BULK 대량 분류·추출 모델 (기본 AI_MODEL과 동일. 비용을 줄이려면 claude-haiku-5-5 등으로 지정)
  AI_FALLBACKS  on(기본) | off  - 안전 분류기로 거절될 때 서버 측 대체 모델로 자동 재시도
  AWS_REGION    bedrock 사용 시 리전 (예: ap-northeast-2)
  ANTHROPIC_API_KEY  anthropic 사용 시 API 키
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Callable

log = logging.getLogger("ai")

PROVIDER = (os.environ.get("AI_PROVIDER") or "anthropic").lower()
MODEL = os.environ.get("AI_MODEL") or "claude-opus-5-5"
MODEL_BULK = os.environ.get("AI_MODEL_BULK") or MODEL
FALLBACKS = os.environ.get("AI_FALLBACKS", "on").lower() != "off"
MAX_TOOL_TURNS = int(os.environ.get("AI_MAX_TOOL_TURNS", "10"))

_client = None
_override = None  # 테스트에서 가짜 클라이언트 주입


class AIUnavailable(RuntimeError):
    pass


class AIRefused(RuntimeError):
    pass


def set_client(client) -> None:
    """테스트용: 가짜 클라이언트 주입 (None 이면 해제)."""
    global _override
    _override = client


def available() -> bool:
    if _override is not None:
        return True
    if PROVIDER == "off":
        return False
    if PROVIDER == "bedrock":
        return True
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def status() -> dict:
    return {"enabled": available(), "provider": PROVIDER, "model": MODEL, "model_bulk": MODEL_BULK}


def client():
    global _client
    if _override is not None:
        return _override
    if not available():
        raise AIUnavailable("AI가 설정되지 않았습니다 (ANTHROPIC_API_KEY 또는 AI_PROVIDER 설정 필요)")
    if _client is None:
        import anthropic
        if PROVIDER == "bedrock":
            from anthropic import AnthropicBedrockMantle
            _client = AnthropicBedrockMantle(aws_region=os.environ.get("AWS_REGION", "ap-northeast-2"))
        else:
            _client = anthropic.Anthropic(max_retries=3)
    return _client


def _model_id(model: str) -> str:
    return f"anthropic.{model}" if PROVIDER == "bedrock" and not model.startswith("anthropic.") else model


def _create(**kw):
    """Messages API 호출. 1st-party API에서는 거절 시 서버 측 대체 모델 사용(beta)."""
    kw["model"] = _model_id(kw["model"])
    c = client()
    if FALLBACKS and PROVIDER == "anthropic" and _override is None:
        return c.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kw)
    return c.messages.create(**kw)


def _text(resp) -> str:
    return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()


def _check(resp) -> None:
    if resp.stop_reason == "refusal":
        raise AIRefused("AI가 이 요청에 답변하지 않았습니다. 질문을 바꿔 다시 시도하세요.")


def _usage(resp) -> dict:
    u = getattr(resp, "usage", None)
    return {"in": getattr(u, "input_tokens", 0) or 0, "out": getattr(u, "output_tokens", 0) or 0}


def complete(system: str, prompt: str, effort: str = "medium", max_tokens: int = 16000,
             model: str | None = None) -> tuple[str, dict]:
    resp = _create(model=model or MODEL, max_tokens=max_tokens, system=system,
                   output_config={"effort": effort},
                   messages=[{"role": "user", "content": prompt}])
    _check(resp)
    return _text(resp), _usage(resp)


def structured(system: str, prompt: str, schema: dict, effort: str = "low",
               max_tokens: int = 16000, model: str | None = None) -> tuple[Any, dict]:
    """JSON 스키마로 출력 형식을 보장받는 호출."""
    resp = _create(model=model or MODEL_BULK, max_tokens=max_tokens, system=system,
                   output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
                   messages=[{"role": "user", "content": prompt}])
    _check(resp)
    return json.loads(_text(resp)), _usage(resp)


def run_agent(system: str, messages: list[dict], tools: list[dict],
              execute: Callable[[str, dict], Any], effort: str = "medium",
              max_tokens: int = 16000) -> dict:
    """도구 호출 루프 (앱 서버가 도구를 실행). 반환: answer, trace, usage."""
    msgs = list(messages)
    trace, usage = [], {"in": 0, "out": 0}
    t0 = time.time()
    for _ in range(MAX_TOOL_TURNS):
        resp = _create(model=MODEL, max_tokens=max_tokens, system=system, tools=tools,
                       output_config={"effort": effort}, messages=msgs)
        u = _usage(resp)
        usage["in"] += u["in"]; usage["out"] += u["out"]
        _check(resp)
        if resp.stop_reason == "pause_turn":
            msgs.append({"role": "assistant", "content": resp.content})
            continue
        calls = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
        if resp.stop_reason != "tool_use" or not calls:
            return {"answer": _text(resp), "trace": trace, "usage": usage, "seconds": round(time.time() - t0, 1)}
        msgs.append({"role": "assistant", "content": resp.content})
        results = []
        for b in calls:
            try:
                out = execute(b.name, dict(b.input or {}))
                content, err = json.dumps(out, ensure_ascii=False, default=str)[:60000], False
            except Exception as e:  # 도구 오류는 모델에게 알려 스스로 수정하게 함
                content, err = f"오류: {e}", True
            trace.append({"tool": b.name, "input": b.input, "error": err})
            results.append({"type": "tool_result", "tool_use_id": b.id, "content": content, "is_error": err})
        msgs.append({"role": "user", "content": results})
    return {"answer": "도구 호출이 너무 많아 중단했습니다. 질문을 더 구체적으로 해 주세요.",
            "trace": trace, "usage": usage, "seconds": round(time.time() - t0, 1)}
