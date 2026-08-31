#!/usr/bin/env bash
# Convenience wrapper for Unix. Runs the clean start script.
# Optionally create/activate a virtualenv and install requirements first:
#   python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
set -e
cd "$(dirname "$0")"
python3 run.py "$@"
