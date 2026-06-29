#!/usr/bin/env bash
# Cluster Organizer Launcher — Linux / macOS
set -euo pipefail

cd "$(dirname "$0")"

echo "============================================"
echo " Cluster Organizer Launcher"
echo "============================================"
echo ""
echo "Logs will be written to .runtime/"
echo ""

# Prefer python3, fallback to python
PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        PYTHON="$cmd"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo "ERROR: Python not found. Please install Python 3.10+."
    exit 1
fi

$PYTHON scripts/app_launcher.py --mode venv
exit_code=$?

if [ $exit_code -ne 0 ]; then
    echo ""
    echo "============================================"
    echo " Launch failed."
    echo "============================================"
    echo ""
    echo "Check these log files:"
    echo "  .runtime/launcher.log"
    echo "  .runtime/backend.log"
    echo "  .runtime/frontend.log"
    echo ""
    echo "Or run in debug mode:"
    echo "  $PYTHON scripts/app_launcher.py --mode venv --debug-windows"
    echo ""
    exit $exit_code
fi
