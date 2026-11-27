@echo off
chcp 65001 >nul
rem ============================================================
rem  공정관리 분석기 - 실행 (창을 닫으면 종료됩니다)
rem ============================================================
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [!] 먼저 install_windows.bat 을 실행하세요.
  pause & exit /b 1
)
if not defined PORT set "PORT=8000"
rem Claude CLI 가 없으면 AI 기능을 끄고(규칙 기반으로만) 실행
if not defined AI_PROVIDER (
  where claude >nul 2>nul || set "AI_PROVIDER=off"
)
rem 같은 네트워크의 동료도 접속하게 하려면 다음 줄의 127.0.0.1 을 0.0.0.0 으로 바꾸세요.
set "HOST=127.0.0.1"

echo 공정관리 분석기를 시작합니다:  http://localhost:%PORT%
echo (이 창을 닫으면 프로그램이 종료됩니다)
start "" cmd /c "timeout /t 4 >nul & start http://localhost:%PORT%"
".venv\Scripts\python.exe" -m uvicorn app.main:app --host %HOST% --port %PORT%
pause
