# Game balance

Every balance **number** — stat growth, XP curve, drop rates, upgrade costs,
salvage yields, combat multipliers, enemy tables — lives in one place:
[`frontend/src/game/balance.js`](../frontend/src/game/balance.js). Tuning the game
means editing balance, not hunting through feature code.

## The one rule: data, not equations

Balance holds tunable **constants and tables**. The **shape** of a formula stays
in code. For example, defense mitigation is `raw * (1 - def/(def + K))` — the
`K` (`combat.mitigationK`) is balance; the shape lives in the dungeon's
`computeAttack`. This keeps balance a plain, safe JSON document (no expression
language, no `eval`).

## Three layers (each deep-merges over the previous)

1. **`DEFAULT_BALANCE`** in `balance.js` — the embedded fallback. The game always
   runs, even fully offline, even if every file below is missing or broken.
2. **[`public/balance.json`](../frontend/public/balance.json)** — bundled with the
   build and copied verbatim into `dist/`, so it's editable **after** build (like
   `config.json`). This is where a local host tweaks balance without rebuilding.
3. **`${apiBase}/balance`** — if a backend is configured (`config.json` `apiBase`),
   its response merges on top and wins. Two backends can therefore serve
   different balance to the same built client. *(The endpoint is a stub today —
   see [backend/app/routers/balance.py](../backend/app/routers/balance.py) — so an
   unreachable/empty backend simply leaves layers 1–2 in effect.)*

A layer may be **partial**: return just `{ "upgrade": { "costGrowth": 1.6 } }`
and only that value changes; everything else falls through to the layer beneath.

`loadBalance()` runs once at startup (in `main.js`, right after `loadConfig` and
before the save is restored, so migrations and stat math see the final numbers).
Consumers read values at call time via `getBalance()`, so they always reflect the
active balance.

## Validation is the trust boundary

`validate()` rebuilds a known-good object field-by-field: an invalid *type*
(string, null, missing) falls back to the default; an out-of-range *number* is
clamped to its bound; enemy tables that aren't non-empty arrays fall back, and
each unit's stats are coerced to non-negative numbers. A malformed or hostile
`balance.json` / backend response can never crash the game or produce `NaN`.
Because balance can come from a backend, treat everything it returns as
untrusted input — never as code.

## What's externalized today

| Section | Feeds | Consumed in |
| --- | --- | --- |
| `leveling` | XP curve (`xpBase`,`xpExponent`), `pointsPerLevel` | `leveling.js` |
| `upgrade` | `statMult`, `costGrowth`, `baseCost` | `items.js` (`itemStatMult`), `upgrade.js` |
| `salvage` | `rarityBase` yield per rarity | `salvage.js` |
| `combat` | weapon mults (`twoHandMult`,`dualWieldMult`,`shieldDefMult`); dungeon tuning (`mitigationK`,`minHit`,`floorGrowth`,`roomsPerFloor`,`turnMs`,`chestChance`,`enemyDropChance`,`xpPerEnemy`,`xpPerBoss`,`flatGrowth`); `enemies`/`bosses` tables | `character.js` `combatProfile`; the dungeon iframe |
| `loot` | rarity drop weights, luck warp (`luckK`), modifier tier bias (`modifierTierFraction`) | `items.js` `rollRarity`/`rarityChances`/`rollTier` |

Not yet externalized (natural next candidate, same pattern): per-stat `base`/
`perPoint` growth (`stats.js` `STAT_DEFS`).

## Item catalogue (separate file)

Item **content** — weapons, armour, name modifiers, legendaries, and the effect
registry — is not balance; it lives in its own layered file,
[`game/items-data.js`](../frontend/src/game/items-data.js) /
[`public/items.json`](../frontend/public/items.json) (with an optional backend
`/items` override), loaded by `loadItems()` and read via `getItems()`. It follows
the exact same default → file → backend → validate pattern as balance. See
[LOOT_RULES.md](LOOT_RULES.md) for how to add items and effects.

## The sandboxed iframe

The dungeon is a sandboxed iframe and **cannot import `balance.js`**. So the shell
sends the whole balance object in the bridge `init` payload (`init.balance`), and
the dungeon's `applyBalance()` overrides its built-in defaults from
`init.balance.combat` — including the enemy/boss tables. If no balance arrives
(e.g. the standalone fallback boot), the dungeon's own defaults keep it playable.
Balance is static per session, so it is sent at `init` only, not on live `stats`
updates.

## Adding a new knob

1. Add the field (with its default) to `DEFAULT_BALANCE` and mirror it in
   `public/balance.json`.
2. Clamp/validate it in `validate()`.
3. Read it via `getBalance().<section>.<key>` at the point of use — remove the
   hard-coded literal there.
4. If a combat/iframe value: it already ships in `init.balance`; read it in the
   dungeon's `applyBalance()` (keep a local default as the fallback).
5. If help text quotes the number, have that text read the same value so it can't
   drift.
