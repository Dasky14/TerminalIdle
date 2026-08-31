"""FastAPI application for TerminalIdleProject.

OPTIONAL backend. The game is fully playable without it — this exists as a
stubbed starting point for future features (cloud save, leaderboards, a
server-authoritative minigame registry).

Run with the clean start script from the backend/ directory:
    python run.py
"""

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Make top-level `config.py` importable whether run via run.py or uvicorn.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config  # noqa: E402

from app.routers import saves, minigames, leaderboard  # noqa: E402

app = FastAPI(
    title="TerminalIdleProject API",
    version="0.1.0",
    description="Optional backend for the terminal-idle game. Not required to play.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
def health():
    """Liveness probe. The frontend's 'Backend status' menu pings this."""
    return {"status": "ok", "service": "terminal-idle", "version": app.version}


app.include_router(saves.router)
app.include_router(minigames.router)
app.include_router(leaderboard.router)
