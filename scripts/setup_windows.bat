@echo off
setlocal
cd /d "%~dp0\.."

set "PY_CMD="
python --version >nul 2>&1 && set "PY_CMD=python"
if not defined PY_CMD py -3 --version >nul 2>&1 && set "PY_CMD=py -3"

if not defined PY_CMD (
    echo Python not found. Please install Python 3.10+ first.
    pause
    exit /b 1
)

echo ============================================
echo  Cluster Organizer Setup
echo ============================================
echo  Installing runtime and frontend dependencies.
echo.

if not exist ".venv\Scripts\python.exe" (
    echo Creating project venv...
    call %PY_CMD% -m venv .venv
    if errorlevel 1 goto fail
)

echo Installing Python dependencies into system Python...
call %PY_CMD% -m pip install -r requirements.txt
if errorlevel 1 goto fail

if exist requirements-dev.txt (
    echo Installing Python dev dependencies into system Python...
    call %PY_CMD% -m pip install -r requirements-dev.txt
    if errorlevel 1 goto fail
)

echo Installing Python dependencies into project venv...
call .venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto fail

if exist requirements-dev.txt (
    echo Installing Python dev dependencies into project venv...
    call .venv\Scripts\python.exe -m pip install -r requirements-dev.txt
    if errorlevel 1 goto fail
)

echo Installing frontend dependencies...
pushd studio\frontend_react
call npm install
if errorlevel 1 (
    popd
    goto fail
)
popd

echo Writing install marker...
call %PY_CMD% scripts\write_install_marker.py --venv-path .venv
if errorlevel 1 goto fail

echo.
echo Setup complete. Future startups will skip dependency installation.
pause
exit /b 0

:fail
echo.
echo Setup failed. Check the output above and rerun scripts\setup_windows.bat.
pause
exit /b 1
