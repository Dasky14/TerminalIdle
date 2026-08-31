#!/usr/bin/env python3
"""Clean start script for the TerminalIdleProject backend.

Usage:
    python run.py

Reads host/port/reload from config.py (which reads .env / environment
variables) and launches the FastAPI app with uvicorn. This is the single
intended entry point — pull the repo on your server machine and run it.
"""

import uvicorn

import config


def main() -> None:
    print(f"TerminalIdleProject backend → http://{config.HOST}:{config.PORT}")
    print(f"  docs:    http://{config.HOST}:{config.PORT}/docs")
    print(f"  CORS:    {config.ALLOWED_ORIGINS}")
    # Pass the app as an import string so reload works.
    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        reload=config.RELOAD,
    )


if __name__ == "__main__":
    main()
