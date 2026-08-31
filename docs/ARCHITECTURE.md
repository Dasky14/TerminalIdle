# Architecture

TerminalIdleProject is a static, client-side game with an optional backend. This
document explains how the pieces fit together.

```
┌───────────────────────────────────────────────────────────────┐
│ Browser (static frontend, Vanilla JS + Vite)                   │
│                                                                │
│  ┌───────────────┐   activates    ┌──────────────────────────┐ │
│  │  Menu shell    │──────────────▶│  Window manager           │ │
│  │  (shell/)      │  openMinigame  │  (windows/)               │ │
│  │  keyboard +    │                │  draggable/resizable      │ │
│  │  mouse nav     │                │  windows, each an <iframe>│ │
│  └──────┬─────────┘                └───────────┬──────────────┘ │
│         │ reads/writes                         │ postMessage     │
│         ▼                                       ▼                │
│  ┌───────────────┐                     ┌──────────────────────┐ │
│  │ Game state     │◀───applyReward─────│  Minigame bridge      │ │
│  │ (game/)        │                    │  (minigames/bridge.js)│ │
│  │ level/xp,      │                    └──────────┬───────────┘ │
│  │ inventory,     │                               │             │
│  │ resources,     │                    ┌──────────▼───────────┐ │
│  │ per-minigame   │                    │  iframe minigame      │ │
│  └──────┬─────────┘                    │  HTML (til-sdk.js) or │ │
│         │ persist                       │  Unity WebGL (jslib)  │ │
│         ▼                               └──────────────────────┘ │
│  localStorage  ◀── export/import JSON file                       │
└───────────────────────────────────────────────────────────────┘
             │ optional, edit config.json at runtime
             ▼
   ┌───────────────────────────┐
   │ Optional FastAPI backend   │  cloud save / leaderboards / registry (stubs)
   │ (backend/, python run.py)  │
   └───────────────────────────┘
```

## Modules

### `game/` — global state & persistence
- **`state.js`** — the single source of truth plus a tiny pub/sub. Everything
  that mutates state calls `emitChange()`; the shell re-renders live screens.
- **`leveling.js` / `inventory.js` / `resources.js`** — typed helpers that own
  their slice of state.
- **`rewards.js`** — `applyReward({xp, resources, items})` fans a minigame reward
  out to the helpers above.
- **`save.js`** — the only module that touches `localStorage` or files.
  Autosave is debounced; `exportSave()` downloads JSON; `importSave()` reads a
  file, validates, migrates, and commits. See [SAVE_FORMAT.md](SAVE_FORMAT.md).

### `shell/` — the terminal-styled, menu-driven UI
- **`menus.js`** — screen definitions built on demand from live state. Each item
  is `{ key, label, action(shell) }`.
- **`shell.js`** — renders the current screen, owns the menu stack + focus,
  and exposes actions (`openMinigame`, `doExport`, `pingBackend`, …).
- **`input.js`** — keyboard: hotkey letters, arrows+Enter, Esc/Backspace = back.
  Ignores keys while a text field is focused.
- **`commandLine.js`** — the optional typed command bar with history.

All three activation paths (letter / arrows+Enter / click) funnel through the
same `item.action(shell)`.

### `windows/` — floating minigame windows
- **`window.js`** — one draggable/resizable panel hosting a sandboxed `<iframe>`.
  Pointer events on the iframe are disabled mid-drag so drags aren't swallowed.
- **`windowManager.js`** — open/focus/z-order/close; creates a bridge per window
  and disposes it on close.

### `minigames/` — catalogue & bridge
- **`registry.js`** — the list of minigames (`id`, `title`, `entry`, `kind`, …).
- **`bridge.js`** — the `postMessage` contract, one per open window. It validates
  `event.source` against the specific iframe and routes messages by `type`.

### `config.js` + `public/config.json` — runtime backend address
`config.json` is fetched at boot. `apiBase: ""` = fully offline. Because it lives
in `public/`, it's copied verbatim into `dist/` and can be edited **after build**
to point a deployed site at a backend — no rebuild.

## The minigame bridge contract

Envelope (both directions): `{ __til: true, dir: 'in'|'out', type, payload }`.

| Direction        | `type`         | Meaning                                           |
| ---------------- | -------------- | ------------------------------------------------- |
| game → shell     | `ready`        | Game loaded; shell replies with `init`.           |
| game → shell     | `reward`       | `{xp?, resources?, items?}` → applied to state.   |
| game → shell     | `progress`     | Persist a minigame-scoped save slice.             |
| game → shell     | `requestClose` | Ask the shell to close the window.                |
| game → shell     | `error`        | Log to shell console.                             |
| shell → game     | `init`         | `{minigameId, profile:{level}, save}` context.    |
| shell → game     | `pause`/`resume`/`shutdown` | Lifecycle signals.                   |

For **Unity WebGL**, `shell → game` is delivered via
`unityInstance.SendMessage("TILBridge", "OnShellMessage", json)` instead of
`postMessage`; `game → shell` still uses `postMessage` (from `TILBridge.jslib`).
See [MINIGAME_GUIDE.md](MINIGAME_GUIDE.md).

## Why these choices

- **Static-first, local save** — no accounts, no server needed to play; easy to
  host free on GitHub Pages.
- **Runtime `config.json`** — one build serves every environment; connect a
  backend by editing a file, not rebuilding.
- **Uniform iframe + postMessage bridge** — HTML and Unity minigames use one
  contract, and iframe isolation keeps a buggy minigame from crashing the shell.
