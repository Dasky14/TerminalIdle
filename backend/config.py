"""Backend configuration.

Values are read from environment variables (optionally loaded from a local .env
file), with sensible defaults so `python run.py` works out of the box.

Edit .env (copy from .env.example) or set real environment variables on your
server. Nothing here is required to play the game — the frontend runs fully
offline; this backend is opt-in.
"""

import os

try:
    # Load a .env file if python-dotenv is installed (it's in requirements.txt).
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover - dotenv is optional
    pass


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


# Interface/port the server binds to.
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))

# Auto-reload on code changes (handy in dev; turn off in production).
RELOAD: bool = os.getenv("RELOAD", "true").lower() in ("1", "true", "yes")

# CORS: which frontend origins may call this API. Because the frontend is a
# static site (e.g. GitHub Pages) it lives on a DIFFERENT origin than this
# backend, so its origin must be listed here.
#
# Default "*" is convenient for local hacking. For a real deployment, set
# ALLOWED_ORIGINS to your Pages URL, e.g.
#   ALLOWED_ORIGINS=https://youruser.github.io
ALLOWED_ORIGINS: list[str] = _split_csv(os.getenv("ALLOWED_ORIGINS", "*")) or ["*"]
