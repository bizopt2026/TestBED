#!/usr/bin/env bash
# 공정관리 분석기 - macOS / Linux 설치 (처음 한 번만 실행)
set -e
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python || true)
[ -z "$PY" ] && { echo "[!] Python 3.10 이상을 설치하세요 (https://www.python.org/downloads/)"; exit 1; }
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || { echo "[!] Python 3.10 이상이 필요합니다"; exit 1; }
echo "[1/3] 가상 환경 만들기 (.venv)"
[ -x .venv/bin/python ] || "$PY" -m venv .venv
echo "[2/3] 필요한 패키지 설치 (몇 분 걸립니다)"
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
echo "[3/3] 데이터 폴더 준비"
.venv/bin/python -c "from app import storage, access; storage.init(); access.init()"
read -r -p "관리자 계정을 만들까요? 혼자 쓰면 N (계정 없이 사용) [y/N]: " MK || true
case "$MK" in
  y|Y) read -r -p "관리자 아이디: " ID; .venv/bin/python -m app.auth create-admin "$ID" ;;
esac
echo "설치 완료. ./start_mac_linux.sh 로 실행하세요."
