@echo off
cd /d "%~dp0.."

python scripts\clean_release.py --dry-run %*
if errorlevel 1 (
    echo.
    echo Python not found. Trying py -3...
    py -3 scripts\clean_release.py --dry-run %*
)
echo.
pause
