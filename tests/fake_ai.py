"""테스트용 가짜 Claude CLI 실행기 (실제 프로세스·네트워크 호출 없음)."""
import json


def _res(**kw):
    base = {"type": "result", "subtype": "success", "is_error": False, "result": "",
            "usage": {"input_tokens": 10, "output_tokens": 5}, "total_cost_usd": 0.0, "num_turns": 1}
    base.update(kw)
    return base


class FakeCLI:
    def __init__(self):
        self.calls = []

    def __call__(self, args, prompt):
        self.calls.append((args, prompt))
        if "--json-schema" in args:
            schema = json.loads(args[args.index("--json-schema") + 1])
            props = schema["properties"]
            if "items" in props:
                ip = props["items"]["items"]["properties"]
                if "trade" in ip:
                    codes = [line.split("\t")[0] for line in prompt.splitlines()[1:] if "\t" in line]
                    return _res(structured_output={"items": [{"code": c, "trade": "철골", "std_name": "철골-테스트"} for c in codes]})
                if "event" in ip:
                    return _res(structured_output={"items": [{"code": "A1050", "event": "착수", "date": "2026-03-05",
                                                             "pct": 10, "evidence": "기초 철근 작업 시작", "confidence": 90}]})
                if "confidence" in ip:
                    return _res(structured_output={"items": [{"pred": "A3070", "succ": "A4020", "type": "FS", "lag": 0,
                                                             "confidence": 80, "reason": "부대공사 후 준공"}]})
                if "category" in ip:
                    return _res(structured_output={"items": [{"title": "철골 납품 지연", "desc": "추정", "codes": ["A2000"],
                                                             "prob": 30, "impact_min": 3, "impact_ml": 7, "impact_max": 14,
                                                             "mitigation": "대체 업체", "category": "자재·장비"}]})
            if "activities" in props:
                acts = [{"code": "M0", "name": "착공", "wbs": "준비", "duration": 0, "milestone": "start", "preds": []},
                        {"code": "A10", "name": "토공", "wbs": "토목", "duration": 10, "milestone": None, "preds": [{"code": "M0", "type": "FS", "lag": 0}]},
                        {"code": "M9", "name": "준공", "wbs": "준공", "duration": 0, "milestone": "finish", "preds": [{"code": "A10", "type": "FS", "lag": 0}]}]
                return _res(structured_output={"wbs": ["준비", "토목", "준공"], "activities": acts, "assumptions": ["테스트 가정"]})
            return _res(structured_output={k: f"- {k} 내용" for k in props})
        if "--mcp-config" in args:
            return _res(result="| ID | 이름 |\n|---|---|\n| A2010 | 철골 세우기 |", num_turns=3)
        return _res(result="1. 테스트 해설")
