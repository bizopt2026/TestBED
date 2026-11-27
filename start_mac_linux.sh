#!/usr/bin/env bash
# 공정관리 분석기 - 실행 (Ctrl+C 로 종료)
# 시작할 때 GitHub 에 새 버전이 있는지 확인하고, 있으면 업데이트합니다. (끄기: UPDATE_CHECK=0)
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo "[!] 먼저 ./install_mac_linux.sh 를 실행하세요"; exit 1; }
PY=.venv/bin/python
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"   # 동료 접속을 허용하려면 HOST=0.0.0.0 ./start_mac_linux.sh
if [ -z "$AI_PROVIDER" ] && ! command -v claude >/dev/null 2>&1; then export AI_PROVIDER=off; fi
export APP_LAUNCHER=1

$PY -m app.updater version
if [ "${UPDATE_CHECK:-1}" != "0" ]; then
  $PY -m app.updater check
  if [ $? -eq 10 ]; then
    ans=Y
    read -r -t 20 -p "지금 업데이트할까요? [Y/n] (20초 후 자동으로 Y) " ans || ans=Y
    case "$ans" in n|N) ;; *) $PY -m app.updater apply ;; esac
  fi
fi

echo "공정관리 분석기: http://localhost:$PORT  (종료: Ctrl+C)"
( sleep 3; (command -v open >/dev/null && open "http://localhost:$PORT") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT") ) >/dev/null 2>&1 &
while true; do
  $PY -m uvicorn app.main:app --host "$HOST" --port "$PORT"
  code=$?
  [ $code -eq 3 ] && { echo "새 버전으로 다시 시작합니다..."; continue; }
  exit $code
done
