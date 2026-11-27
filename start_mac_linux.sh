#!/usr/bin/env bash
# 공정관리 분석기 - 실행 (Ctrl+C 로 종료)
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo "[!] 먼저 ./install_mac_linux.sh 를 실행하세요"; exit 1; }
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"   # 동료 접속을 허용하려면 HOST=0.0.0.0 ./start_mac_linux.sh
if [ -z "$AI_PROVIDER" ] && ! command -v claude >/dev/null 2>&1; then export AI_PROVIDER=off; fi
echo "공정관리 분석기: http://localhost:$PORT  (종료: Ctrl+C)"
( sleep 3; (command -v open >/dev/null && open "http://localhost:$PORT") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT") ) >/dev/null 2>&1 &
exec .venv/bin/python -m uvicorn app.main:app --host "$HOST" --port "$PORT"
