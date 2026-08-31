# Backend (optional)

A small **FastAPI** service. **The game is fully playable without it** — this is
an opt-in starting point for future features (cloud save, leaderboards, a
server-side minigame registry).

Intended workflow: host the built frontend as a static site (e.g. GitHub Pages),
then pull this same repo on a server machine and run one script.

## Run

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# Unix:     source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

Or use the wrappers: `start.bat` (Windows) / `./start.sh` (Unix).

Then open http://localhost:8000/docs for the interactive API docs, and
http://localhost:8000/health for the liveness probe.

## Configuration

Copy `.env.example` to `.env` and edit, or set environment variables directly.
See [`config.py`](config.py) for all options.

| Variable          | Default   | Meaning                                             |
| ----------------- | --------- | --------------------------------------------------- |
| `HOST`            | `0.0.0.0` | Interface to bind.                                  |
| `PORT`            | `8000`    | Port to bind.                                       |
| `RELOAD`          | `true`    | Auto-reload on code changes (turn off in prod).     |
| `ALLOWED_ORIGINS` | `*`       | Comma-separated frontend origins allowed via CORS.  |

Because the frontend is served from a **different origin** than this backend,
set `ALLOWED_ORIGINS` to your frontend URL in production, e.g.
`ALLOWED_ORIGINS=https://youruser.github.io`.

## Connecting the frontend

Point the frontend at this backend by editing **one runtime file** — no rebuild:

`frontend/public/config.json` (or `frontend/dist/config.json` in a deployed build):

```json
{ "apiBase": "https://your-server.example:8000" }
```

The frontend's **System → Backend status** menu pings `${apiBase}/health`.

## Endpoints (all stubs)

| Method | Path                       | Purpose                              |
| ------ | -------------------------- | ------------------------------------ |
| GET    | `/health`                  | Liveness probe.                      |
| PUT    | `/saves/{id}`              | Store an opaque save blob.           |
| GET    | `/saves/{id}`              | Retrieve a stored save blob.         |
| GET    | `/minigames`               | Server-side minigame registry.       |
| POST   | `/leaderboard`             | Submit a score.                      |
| GET    | `/leaderboard/{minigame}`  | Top scores for a minigame.           |

Storage is **in-memory** — restarting loses data. Replace with a real store
before relying on it.
