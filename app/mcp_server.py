"""앱의 읽기 전용 공정 조회 도구를 Claude CLI 에 제공하는 최소 MCP 서버 (stdio, JSON-RPC 2.0).

    python -m app.mcp_server <upload_id>

원본 데이터를 바꾸는 도구는 없다(what_if 는 사본으로 계산만 한다).
"""
from __future__ import annotations

import json
import sys


def main(uid: str) -> None:
    from . import services
    execute = services.tool_executor(uid)
    tools = [{"name": t["name"], "description": t["description"], "inputSchema": t["input_schema"]}
             for t in services.CHAT_TOOLS]

    def reply(mid, result=None, error=None):
        msg = {"jsonrpc": "2.0", "id": mid}
        if error:
            msg["error"] = error
        else:
            msg["result"] = result
        sys.stdout.write(json.dumps(msg, ensure_ascii=False, default=str) + "\n")
        sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        method, mid = req.get("method"), req.get("id")
        if mid is None:  # 알림(notification)은 응답하지 않음
            continue
        params = req.get("params") or {}
        if method == "initialize":
            reply(mid, {"protocolVersion": params.get("protocolVersion", "2025-06-18"),
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "schedule-analyzer", "version": "1.0"}})
        elif method == "tools/list":
            reply(mid, {"tools": tools})
        elif method == "tools/call":
            name = params.get("name")
            try:
                out = execute(name, params.get("arguments") or {})
                text = json.dumps(out, ensure_ascii=False, default=str)[:60000]
                reply(mid, {"content": [{"type": "text", "text": text}], "isError": False})
            except Exception as e:  # 도구 오류는 모델이 보고 스스로 수정하도록 결과로 돌려준다
                reply(mid, {"content": [{"type": "text", "text": f"오류: {e}"}], "isError": True})
        elif method == "ping":
            reply(mid, {})
        else:
            reply(mid, error={"code": -32601, "message": f"지원하지 않는 메서드: {method}"})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("사용법: python -m app.mcp_server <upload_id>")
    main(sys.argv[1])
