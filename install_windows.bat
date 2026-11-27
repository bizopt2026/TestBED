@echo off
chcp 65001 >nul
rem ============================================================
rem  PMS - Windows 설치 (처음 한 번만 실행, PMS 현장·PMS 대시보드 공통)
rem ============================================================
cd /d "%~dp0"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo [!] Python 이 없습니다. https://www.python.org/downloads/ 에서 Python 3.11 이상을 설치하세요.
  echo     설치 첫 화면에서 "Add python.exe to PATH" 를 꼭 체크하세요.
  pause & exit /b 1
)
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
if errorlevel 1 (
  echo [!] Python 3.10 이상이 필요합니다. 새 버전을 설치한 뒤 다시 실행하세요.
  pause & exit /b 1
)

echo [1/3] 가상 환경 만들기 (.venv)
if not exist ".venv\Scripts\python.exe" %PY% -m venv .venv
if errorlevel 1 ( echo [!] 가상 환경을 만들지 못했습니다. & pause & exit /b 1 )

echo [2/3] 필요한 패키지 설치 (몇 분 걸립니다)
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [!] 패키지 설치에 실패했습니다. 사내 프록시가 있다면 IT 담당자에게 pip 프록시 설정을 문의하세요.
  pause & exit /b 1
)

echo [3/3] 데이터 폴더 준비
".venv\Scripts\python.exe" -c "from app import storage, access; storage.init(); access.init()"

echo.
set /p MKADMIN="관리자 계정을 만들까요? 혼자 쓰면 N (계정 없이 사용) [y/N]: "
if /i "%MKADMIN%"=="y" (
  set /p ADMINID="관리자 아이디: "
  call ".venv\Scripts\python.exe" -m app.auth create-admin %%ADMINID%%
)

echo.
echo 설치 완료. 이제 start_windows.bat 을 더블클릭하면 실행됩니다.
pause
