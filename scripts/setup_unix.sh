#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
        PYTHON="$cmd"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo "Python not found. Please install Python 3.10+ first."
    exit 1
fi

echo "============================================"
echo " Cluster Organizer Setup"
echo "============================================"
echo " Installing runtime and frontend dependencies."
echo ""

if [ ! -x ".venv/bin/python" ]; then
    echo "Creating project venv..."
    "$PYTHON" -m venv .venv
fi

"$PYTHON" -m pip install -r requirements.txt
if [ -f requirements-dev.txt ]; then
    "$PYTHON" -m pip install -r requirements-dev.txt
fi

".venv/bin/python" -m pip install -r requirements.txt
if [ -f requirements-dev.txt ]; then
    ".venv/bin/python" -m pip install -r requirements-dev.txt
fi

if [ -f "studio/frontend_react/package.json" ]; then
    (cd studio/frontend_react && npm install)
fi

"$PYTHON" scripts/write_install_marker.py --venv-path .venv

echo ""
echo "Setup complete. Future startups will skip dependency installation."
