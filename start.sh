#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "============================================"
echo " Cluster Organizer Launcher"
echo "============================================"
echo ""
echo "Logs will be written to .runtime/"
echo ""

PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
        PYTHON="$cmd"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo "ERROR: Python not found. Please install Python 3.10+."
    exit 1
fi

if [ ! -x ".venv/bin/python" ]; then
    echo "ERROR: .venv is missing."
    echo "Please run scripts/setup_unix.sh first."
    exit 1
fi

if ! "$PYTHON" scripts/check_install_state.py; then
    echo ""
    echo "Dependencies are missing or changed."
    echo "Please run scripts/setup_unix.sh first."
    exit 1
fi

if ! .venv/bin/python scripts/check_runtime_imports.py; then
    echo ""
    echo "Python runtime check failed."
    echo "Please run scripts/setup_unix.sh to repair dependencies."
    exit 1
fi

if ! "$PYTHON" scripts/app_launcher.py --mode venv; then
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
    exit 1
fi
