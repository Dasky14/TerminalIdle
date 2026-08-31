# TerminalIdleProject

A browser game with a **fake Linux-terminal front end**. The terminal look wraps a
**menu-driven navigator** — every screen is a list of hotkey-labeled options you can
drive **entirely by keyboard or entirely by mouse**:

```
user@til:~$

  S: Stats
  I: Inventory
  G: Games
  Y: System

  ▸ press a letter, use ↑/↓ + Enter, or click a line
```

The "game" itself is a collection of small **minigames**. Launching one opens a
**draggable, resizable window** floating over the terminal, with the minigame running
inside an `<iframe>` — so it can be plain HTML/JS **or** a **Unity WebGL** build.
Minigames hand **global rewards** (XP, resources, items) back to the shell through a
small `postMessage` bridge.

There are **no accounts**. Your entire save (global level/XP, inventory, resources,
per-minigame progress) lives in the browser's `localStorage` and can be **exported and
imported** as a JSON file.

---

## Features

- 🖥️ **Terminal-styled, menu-first UI** — keyboard hotkeys, arrow-key navigation, and
  mouse clicks all work equivalently.
- 🎮 **Minigames in floating windows** — draggable/resizable, iframe-hosted, HTML or
  Unity WebGL.
- 🌐 **Uniform minigame bridge** — one `postMessage` contract for both HTML and Unity
  games (`ready` / `reward` / `progress` / `close`).
- 📈 **Global progression** — leveling, inventory, and named resources shared across all
  minigames.
- 💾 **Local-only saves** — `localStorage` persistence plus JSON export/import. No server
  required to play.
- 🔌 **Optional FastAPI backend** — a clean `python run.py` start script for future
  cloud-save / leaderboards, pointed at via an **editable runtime config** (no rebuild).

---

## Quickstart (play locally)

```bash
cd frontend
npm install
npm run dev
```

Open the printed URL. Navigate with the keyboard (letters / arrows / Esc) or the mouse.
Open **Games → Sample Clicker** to see the reward loop update your global XP and
resources, then reload the page — your progress persists.

Build a static site (for GitHub Pages, etc.):

```bash
cd frontend
npm run build
```

The output in `frontend/dist/` is fully static.

---

## Optional backend

The frontend plays fully offline. The backend is opt-in and meant to run on a **separate
server machine** (pull the same repo, run one script).

```bash
cd backend
pip install -r requirements.txt
python run.py
```

Then point the frontend at it by editing **one runtime file** — no rebuild needed:

`frontend/public/config.json` (or `frontend/dist/config.json` in a deployed build):

```json
{ "apiBase": "https://your-server.example:8000" }
```

Leave `"apiBase": ""` (the default) to stay fully offline. The **System → Backend
status** menu pings `${apiBase}/health` and reports online/offline.

See [`backend/README.md`](backend/README.md) for host/port/CORS configuration.

---

## Adding your own minigames

Minigames are just web content in an iframe. Register them in
[`frontend/src/minigames/registry.js`](frontend/src/minigames/registry.js) and talk to
the shell with the SDK in [`minigame-sdk/`](minigame-sdk/).

- **HTML minigames:** include `til-sdk.js` and call `TIL.sendReward(...)`.
- **Unity WebGL:** drop in `TILBridge.jslib` + `TILBridge.cs`.

Full walkthrough: [`docs/MINIGAME_GUIDE.md`](docs/MINIGAME_GUIDE.md).

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the shell, game state, windows, and
  bridge fit together.
- [`docs/MINIGAME_GUIDE.md`](docs/MINIGAME_GUIDE.md) — authoring HTML and Unity WebGL
  minigames.
- [`docs/SAVE_FORMAT.md`](docs/SAVE_FORMAT.md) — the versioned save schema and migrations.

---

## Layout

```
frontend/      Vanilla JS + Vite. The terminal shell, game state, windows, bridge.
backend/       Optional FastAPI service (clean `python run.py` start script).
minigame-sdk/  Drop-in bridge for HTML minigames + Unity WebGL plugin/stub.
docs/          Architecture, minigame authoring, save format.
```

## License

MIT — see [`LICENSE`](LICENSE).
