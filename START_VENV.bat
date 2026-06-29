@echo off
setlocal
cd /d "%~dp0"

set "PY_CMD="
python --version >nul 2>&1 && set "PY_CMD=python"
if not defined PY_CMD py -3 --version >nul 2>&1 && set "PY_CMD=py -3"

if not defined PY_CMD (
    echo Python not found. Please install Python 3.10+ or run scripts\setup_windows.bat.
    pause
    exit /b 1
)

echo ============================================
echo  Cluster Organizer Launcher
echo ============================================
echo  Mode: project venv
echo  Logs will be written to .runtime\
echo.

call %PY_CMD% scripts\check_install_state.py
if errorlevel 1 goto need_setup

if exist .venv\Scripts\python.exe (
    .venv\Scripts\python.exe scripts\check_runtime_imports.py
    if errorlevel 1 goto need_setup
)

call %PY_CMD% scripts\app_launcher.py --mode venv
if errorlevel 1 goto launch_failed

exit /b 0

:need_setup
echo.
echo Dependencies are missing or changed.
echo Please run scripts\setup_windows.bat first.
pause
exit /b 1

:launch_failed
echo.
echo ============================================
echo  Launch failed.
echo ============================================
echo.
echo Check these log files:
echo   .runtime\launcher.log
echo   .runtime\backend.log
echo   .runtime\frontend.log
echo.
echo Or run:
echo   python scripts\app_launcher.py --mode venv --debug-windows
echo.
pause
exit /b 1
