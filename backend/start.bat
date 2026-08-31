@echo off
REM Convenience wrapper for Windows. Runs the clean start script.
REM Optionally create/activate a virtualenv and install requirements first:
REM   python -m venv .venv && .venv\Scripts\activate && pip install -r requirements.txt
python run.py %*
