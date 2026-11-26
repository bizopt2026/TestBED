"""테스트용 가짜 Claude 클라이언트 (네트워크 호출 없음)."""
import json
from types import SimpleNamespace as NS


def _resp(blocks, stop="end_turn"):
    return NS(content=blocks, stop_reason=stop, usage=NS(input_tokens=10, output_tokens=5))


def text(t):
    return NS(type="text", text=t)


class FakeMessages:
    def __init__(self, handler):
        self.handler = handler
        self.calls = []

    def create(self, **kw):
        self.calls.append(kw)
        return self.handler(kw, len(self.calls))


class FakeClient:
    def __init__(self, handler):
        self.messages = FakeMessages(handler)
        self.beta = NS(messages=self.messages)


def default_handler(kw, n):
    fmt = (kw.get("output_config") or {}).get("format")
    if fmt:
        props = fmt["schema"]["properties"]
        if "items" in props:
            item_props = props["items"]["items"]["properties"]
            prompt = kw["messages"][0]["content"]
            if "trade" in item_props:
                codes = [line.split("\t")[0] for line in prompt.splitlines()[1:] if "\t" in line]
                return _resp([text(json.dumps({"items": [{"code": c, "trade": "철골", "std_name": "철골-테스트"} for c in codes]}))])
            if "event" in item_props:
                return _resp([text(json.dumps({"items": [{"code": "A1050", "event": "착수", "date": "2026-03-05",
                                                           "pct": 10, "evidence": "기초 철근 작업 시작", "confidence": 90}]}))])
            if "confidence" in item_props:
                return _resp([text(json.dumps({"items": [{"pred": "A3070", "succ": "A4020", "type": "FS", "lag": 0,
                                                           "confidence": 80, "reason": "부대공사 후 준공"}]}))])
        return _resp([text(json.dumps({k: f"- {k} 내용" for k in props}))])
    if kw.get("tools"):
        last = kw["messages"][-1]
        if isinstance(last["content"], str):
            return _resp([NS(type="tool_use", id="t1", name="search_activities",
                             input={"longest_path_only": True, "limit": 5})], stop="tool_use")
        data = json.loads(last["content"][0]["content"])
        codes = [x["code"] for x in data["items"]]
        return _resp([text("| ID | 이름 |\n|---|---|\n" + "\n".join(f"| {c} | x |" for c in codes))])
    return _resp([text("1. 테스트 해설")])
