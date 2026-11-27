@echo off
chcp 65001 >nul
rem ============================================================
rem  PMS 대시보드 - 실행 (창을 닫으면 종료됩니다)
rem  시작할 때 GitHub 에 새 버전이 있는지 확인하고, 있으면 업데이트합니다.
rem  (확인을 끄려면: set UPDATE_CHECK=0)
rem ============================================================
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [!] 먼저 install_windows.bat 을 실행하세요.
  pause & exit /b 1
)
set "PY=.venv\Scripts\python.exe"
if not defined PORT set "PORT=8100"
rem Claude CLI 가 없으면 AI 기능을 끄고(규칙 기반으로만) 실행
if not defined AI_PROVIDER (
  where claude >nul 2>nul || set "AI_PROVIDER=off"
)
rem PMS 대시보드는 사내망의 다른 PC가 접속하므로 0.0.0.0 (방화벽에서 포트 허용 필요)
set "HOST=0.0.0.0"
set "APP_LAUNCHER=1"
set "PMS_EDITION=server"

%PY% -m app.updater version
if /i not "%UPDATE_CHECK%"=="0" (
  %PY% -m app.updater check
  if errorlevel 10 (
    choice /c YN /t 20 /d Y /m "지금 업데이트할까요? (20초 후 자동으로 Y)"
    if not errorlevel 2 %PY% -m app.updater apply
  )
)

echo.
echo PMS 대시보드를 시작합니다:  http://localhost:%PORT%
echo (이 창을 닫으면 프로그램이 종료됩니다)
start "" cmd /c "timeout /t 4 >nul & start http://localhost:%PORT%"
:run
%PY% -m uvicorn app.main:app --host %HOST% --port %PORT%
rem 화면에서 '업데이트'를 누르면 종료 코드 3으로 끝나고, 여기서 새 버전으로 다시 시작합니다.
if errorlevel 3 if not errorlevel 4 (
  echo 새 버전으로 다시 시작합니다...
  goto run
)
pause
