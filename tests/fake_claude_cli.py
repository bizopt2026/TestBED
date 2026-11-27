#!/usr/bin/env python3
"""테스트용 가짜 Claude CLI 실행 파일 (별도 프로세스로 띄운 PMS 대시보드에서 AI 게이트웨이 확인용)."""
import json
import sys

args = sys.argv[1:]
prompt = sys.stdin.read()
out = {"type": "result", "subtype": "success", "is_error": False, "usage": {"input_tokens": 3, "output_tokens": 2}, "total_cost_usd": 0.0, "num_turns": 1}
if "--json-schema" in args:
    out["structured_output"] = {"items": []}
    out["result"] = "{}"
elif "--mcp-config" in args:
    out["result"] = "서버 게이트웨이 도구 답변"
else:
    out["result"] = "서버 게이트웨이 설명: " + prompt[:20]
print(json.dumps(out, ensure_ascii=False))
