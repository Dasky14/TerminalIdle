# Save format

The entire game is stored client-side. There are no accounts. The save lives in
`localStorage` under the key `til.save.v1` and can be exported/imported as a JSON
file from **System → Export / Import** (or the `export` / `import` commands).

## Schema (version 1)

```jsonc
{
  "version": 1,
  "profile": {
    "level": 1,      // global level
    "xp": 0          // XP banked toward the NEXT level (not cumulative lifetime)
  },
  "inventory": [
    { "id": "gear", "name": "Gear", "qty": 3 }   // stacked by id
  ],
  "resources": {
    "scrap": 12,     // flat name → amount map
    "credits": 0
  },
  "minigames": {
    "dungeon": { "floor": 3 }                    // per-minigame slice, opaque to the shell
  },
  "meta": {
    "createdAt": 1735689600000,   // epoch ms
    "updatedAt": 1735693200000
  }
}
```

### Field notes

- **`profile.xp`** is the XP toward the next level, not lifetime XP. Leveling
  consumes it; the curve is `xpForLevel(level) = floor(100 * level^1.5)` (see
  [`leveling.js`](../frontend/src/game/leveling.js)).
- **`inventory`** items stack by `id`; `name` is display-only.
- **`resources`** is a flat map; values are clamped at ≥ 0.
- **`minigames[<id>]`** is whatever a minigame passes to `TIL.saveProgress()`.
  The shell stores it verbatim and hands it back via `init.save`.

## Persistence behavior

- **Autosave** is debounced (~400 ms) after any state change
  ([`save.js`](../frontend/src/game/save.js), `enableAutosave`).
- **Load** validates the blob structurally, then runs migrations up to the
  current version. An invalid/corrupt save falls back to a fresh game rather than
  throwing.
- **Export** downloads `terminal-idle-save-<timestamp>.json`.
- **Import** validates + migrates the chosen file, then replaces state and
  persists it.

## Migrations

When the schema changes, bump `SAVE_VERSION` in
[`state.js`](../frontend/src/game/state.js) and add a step to the `MIGRATIONS`
map in [`save.js`](../frontend/src/game/save.js):

```js
const MIGRATIONS = {
  1: (old) => ({ ...old, version: 2, /* transform */ }),
};
```

`migrate()` applies steps in order (`v → v+1`) until the save reaches the current
version. A missing step for an old version resets to a fresh save (logged as a
warning) rather than corrupting state.
