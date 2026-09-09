# Save format

The entire game is stored client-side. There are no accounts. The save lives in
`localStorage` under the key `til.save.v1` and can be exported/imported as a JSON
file from **System → Export / Import** (or the `export` / `import` commands).

## Schema (version 4)

```jsonc
{
  "version": 4,
  "profile": {
    "level": 1,      // global level
    "xp": 0          // XP banked toward the NEXT level (not cumulative lifetime)
  },
  "stats": { "patt": 3 },   // allocated POINTS per stat id (v2+; missing = 0)
  "statPoints": 4,          // unspent stat points (v2+)
  "equipment": {            // equipped item per slot, or null (v3+)
    "head": null, "chest": null, "hands": null, "legs": null, "feet": null,
    "weapon1": null, "weapon2": null
  },
  "inventory": [
    { "id": "gear", "name": "Gear", "qty": 3 },  // stacked by id
    { "id": "it-abc", "name": "Keen Sword", "qty": 1, "meta": { /* item */ } }
  ],
  "resources": {
    "scrap": 12,     // flat name → amount map; salvaging physical gear
    "essence": 4     // salvaging magical gear
  },
  "autoScrap": {                       // v4: auto-salvage drops on pickup
    "all": ["common", "rare"],         // fallback rarity list
    "byType": { "weapon": ["epic"] }   // per-slot overrides ('weapon' = all weapons)
  },
  "minigames": {
    "dungeon": { "floor": 3 }          // per-minigame slice, opaque to the shell
  },
  "minigameMeta": {                    // v4: shell-owned per-minigame metadata
    "dungeon": { "lastOpen": 1735693200000 }  // epoch ms, for idle away-time
  },
  "meta": {
    "createdAt": 1735689600000,   // epoch ms
    "updatedAt": 1735693200000
  }
}
```

### Field notes

- **`profile.xp`** is the XP toward the next level, not lifetime XP. Leveling
  consumes it; the curve is `xpForLevel(level) = floor(100 * level^1.1)` (see
  [`leveling.js`](../frontend/src/game/leveling.js)).
- **`inventory`** items stack by `id`; `name` is display-only. Equipment items
  carry the full item object under `meta` (with `slot`, `stats`, `rarity`, and —
  for upgraded gear — an `upgrade` level shown after the name as `+N`).
- **`resources`** is a flat map; values are clamped at ≥ 0. `scrap` and
  `essence` come from salvaging gear (see [`salvage.js`](../frontend/src/game/salvage.js))
  and are spent on weapon upgrades ([`upgrade.js`](../frontend/src/game/upgrade.js)).
- **`autoScrap`** rules salvage qualifying drops the instant they're obtained. A
  drop is scrapped if its rarity is listed under its type in `byType`, or — when
  that type has no entry — under `all`.
- **`minigames[<id>]`** is whatever a minigame passes to `TIL.saveProgress()`.
  The shell stores it verbatim (shallow-replaced) and hands it back via `init.save`.
- **`minigameMeta[<id>].lastOpen`** is stamped by the shell every ~15 s while a
  game window is open and again on close. On the next open the bridge sends the
  game `init.awayMs` (elapsed since `lastOpen`, capped at 24 h) so it can bank
  offline progress. It is **shell-owned** and kept out of the game's own slice so
  a `saveProgress()` call can't clobber it.

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
