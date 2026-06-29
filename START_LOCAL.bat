@echo off
cd /d "%~dp0"

echo ============================================
echo  Cluster Organizer Launcher (System Python)
echo ============================================
echo  Uses system Python directly, no venv.
echo  Logs will be written to .runtime\
echo.

python scripts\app_launcher.py --mode system
if errorlevel 1 (
    echo.
    echo Python not found. Trying py -3...
    py -3 scripts\app_launcher.py --mode system
)

if errorlevel 1 (
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
    pause
    exit /b 1
)
