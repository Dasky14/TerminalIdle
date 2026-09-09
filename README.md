# TerminalIdleProject

A browser game with a **fake Linux-terminal front end**. The terminal look wraps a
**menu-driven navigator** — every screen is a numbered list of options you can drive
**entirely by keyboard or entirely by mouse**: type an option's **number** or **name**
(partial is fine, e.g. `inv`), or **click** it.

```
:: MAIN MENU
----------------------------------------------------------
 1) Stats
 2) Equipment
 3) Inventory
 4) Resources
 5) Games
 6) System

type a number or name below, or click an option
```

The screen has three panes: the **menu** (top), a **game log** of things happening in
running minigames (middle), and a persistent **terminal** transcript with the command
line (bottom).

The "game" itself is a collection of small **minigames**. Launching one opens a
**draggable, resizable window** floating over the terminal, with the minigame running
inside an `<iframe>` — so it can be plain HTML/JS **or** a **Unity WebGL** build.
Minigames hand **global rewards** (XP, resources, items) back to the shell through a
small `postMessage` bridge.

There are **no accounts**. Your entire save (level/XP, stats, equipment, inventory,
resources, per-minigame progress) lives in the browser's `localStorage` and can be
**exported and imported** as a JSON file.

---

## Features

- 🖥️ **Terminal-styled, menu-first UI** — a three-pane shell (menu / game log /
  terminal); navigate by number, by name, or by mouse, all equivalently.
- 🧬 **Character progression** — global level & XP, allocatable stat points across 11
  stats (HP, P/M attack & defense, Speed, Acc, Dodge, crit, Luck), and 7 equipment
  slots (5 armour + 2 weapon).
- 🗡️ **Loot & gear** — randomly generated items in four rarities (common → legendary)
  with weighted, multi-tier name modifiers, plus named **legendaries** carrying unique
  **effects**. **Luck** biases drop rarity.
- ♻️ **A closed economy** — **salvage** gear into `scrap` (physical) and `essence`
  (magical), with configurable **auto-scrap** rules, and **upgrade** gear `+N` for an
  exponential material cost (legendaries also consume duplicates).
- ⚔️ **Endless Dungeon** — an auto-battler where your **equipped weapons** decide the
  damage type and multipliers (two-handed 1.3×, dual-wield 0.6× each, shield +20%
  defense). Enemies drop gear and XP.
- 💤 **Idle away-time** — reopen a game after a break and it banks the offline progress
  ("Away 3h 12m — reached Floor 14, +2,300 XP, 6 items").
- 🎮 **Minigames in floating windows** — draggable/resizable, iframe-hosted, HTML or
  Unity WebGL, via one uniform `postMessage` bridge.
- 💾 **Local-only saves** — `localStorage` persistence plus JSON export/import. No
  server required to play.
- 🎚️ **Data-driven balance & items** — every tuning number and all item content lives
  in editable JSON (`balance.json` / `items.json`), overridable per-deployment through
  an **optional FastAPI backend** — no rebuild.

---

## Quickstart (play locally)

```bash
cd frontend
npm install
npm run dev
```

Open the printed URL. Navigate by typing an option's number/name or clicking it. Open
**Games → Endless Dungeon** to auto-battle for XP and gear, which feed your global
level, stat points, equipment, and resources — then reload the page; progress persists.

Build a static site (for GitHub Pages, etc.):

```bash
cd frontend
npm run build
```

The output in `frontend/dist/` is fully static.

---

## Tuning balance & items

All game tuning and item content is data, loaded at startup from an embedded default →
a bundled JSON file → an optional backend override (each deep-merged and validated):

- **[`frontend/public/balance.json`](frontend/public/balance.json)** — stat growth, XP
  curve, upgrade/salvage costs, drop rates & luck, and combat tuning (multipliers,
  enemy tables). Edit it in a deployed `dist/` and reload — no rebuild.
- **[`frontend/public/items.json`](frontend/public/items.json)** — the item catalogue:
  weapons/armour, name modifiers (id + weight + per-tier stats), legendaries, and an
  **effect registry** (attach an effect to any item by listing its id).

See [`docs/BALANCE.md`](docs/BALANCE.md) and [`docs/LOOT_RULES.md`](docs/LOOT_RULES.md).

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

Leave `"apiBase": ""` (the default) to stay fully offline. When a backend is set, the
frontend also merges its `GET /balance` and `GET /items` responses over the bundled
JSON (both stubs today), so different servers can serve different balance. The **System
→ Backend status** menu pings `${apiBase}/health`.

See [`backend/README.md`](backend/README.md) for host/port/CORS configuration.

---

## Adding your own minigames

Minigames are just web content in an iframe. Register them in
[`frontend/src/minigames/registry.js`](frontend/src/minigames/registry.js) and talk to
the shell with the SDK in [`minigame-sdk/`](minigame-sdk/).

- **HTML minigames:** include `til-sdk.js` and call `TIL.sendReward(...)`. On `init` the
  shell hands the game the player's combat stats, effects, weapon combat profile, and
  (for tuning) the active balance.
- **Unity WebGL:** drop in `TILBridge.jslib` + `TILBridge.cs`.

Full walkthrough: [`docs/MINIGAME_GUIDE.md`](docs/MINIGAME_GUIDE.md).

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the shell, game state, windows, and
  bridge fit together.
- [`docs/BALANCE.md`](docs/BALANCE.md) — the data-driven balance system (layers,
  validation, how to add a knob).
- [`docs/LOOT_RULES.md`](docs/LOOT_RULES.md) — weapon-combat rules and how to add items,
  modifiers, and effects.
- [`docs/MINIGAME_GUIDE.md`](docs/MINIGAME_GUIDE.md) — authoring HTML and Unity WebGL
  minigames.
- [`docs/SAVE_FORMAT.md`](docs/SAVE_FORMAT.md) — the versioned save schema and migrations.

---

## Layout

```
frontend/      Vanilla JS + Vite. The terminal shell, game state, windows, bridge.
  public/      Runtime-editable config.json, balance.json, items.json + bundled minigames.
backend/       Optional FastAPI service (clean `python run.py` start script).
minigame-sdk/  Drop-in bridge for HTML minigames + Unity WebGL plugin/stub.
docs/          Architecture, balance, loot rules, minigame authoring, save format.
```

## License

MIT — see [`LICENSE`](LICENSE).
