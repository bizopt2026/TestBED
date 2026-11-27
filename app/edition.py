"""PMS 판 구분과 AI 실행 위치.

PMS_EDITION   client(기본) = PMS 현장  |  server = PMS 대시보드
PMS_AI_MODE   server(기본) | local | auto | off
              - server: AI 는 PMS 대시보드(서버)에서만 실행. PMS 현장은 서버의 AI 게이트웨이를 통해 사용
              - local : 이 PC 의 Claude CLI 로 실행
              - auto  : 이 PC 에 CLI 가 있으면 로컬, 없으면 서버
              - off   : AI 끔(규칙 기반)
PMS_HUB_URL   PMS 현장이 연결할 PMS 대시보드 주소 (P2 게시·구독·AI 게이트웨이에서 사용)

PMS 대시보드에 연결하지 않은 '단독 실행' PMS 현장은 지금처럼 이 PC 의 CLI 로 AI 를 쓴다.
"""
import os

EDITION = (os.environ.get("PMS_EDITION") or "client").lower()
if EDITION not in ("client", "server"):
    EDITION = "client"
NAMES = {"client": "PMS 현장", "server": "PMS 대시보드"}
AI_MODE = (os.environ.get("PMS_AI_MODE") or "server").lower()
if AI_MODE not in ("server", "local", "auto", "off"):
    AI_MODE = "server"
HUB_URL = os.environ.get("PMS_HUB_URL", "").rstrip("/")


def name() -> str:
    return NAMES[EDITION]


def ai_route() -> tuple[str, str]:
    """(실행 위치, 설명). 위치: local | gateway | off"""
    if AI_MODE == "off":
        return "off", "AI가 꺼져 있습니다 (PMS_AI_MODE=off)"
    if EDITION == "server":
        return "local", "PMS 대시보드 서버에서 실행"
    hub = HUB_URL
    if not hub:   # 내 설정에서 연결한 대시보드 주소도 인정
        try:
            from . import storage
            hub = storage.setting("*", "hub_url")
        except Exception:  # noqa: BLE001 — 시작 중(DB 준비 전)에는 단독 실행으로 봄
            hub = None
    if not hub:
        return "local", "PMS 대시보드에 연결하지 않은 단독 실행: 이 PC에서 실행"
    if AI_MODE == "local":
        return "local", "이 PC에서 실행 (PMS_AI_MODE=local)"
    if AI_MODE == "auto":
        return "auto", "이 PC에 Claude CLI가 있으면 이 PC, 없으면 PMS 대시보드"
    return "gateway", "PMS 대시보드에서 실행 (서버 AI 게이트웨이)"


def config() -> dict:
    where, note = ai_route()
    return {"edition": EDITION, "edition_name": name(), "ai_mode": AI_MODE, "ai_route": where, "ai_route_note": note, "hub": bool(HUB_URL)}
