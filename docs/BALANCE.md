# Game balance

Every balance **number** — character growth, XP curve, drop rates, upgrade costs,
salvage yields, combat multipliers, enemy tables — lives in one file:
[`frontend/public/balance.json`](../frontend/public/balance.json). Tuning the game
means editing that JSON, not hunting through feature code. (Item *content* —
weapons, modifiers, legendaries, effects — is the sibling file
[`public/items.json`](../frontend/public/items.json); see [LOOT_RULES.md](LOOT_RULES.md).)

## The one rule: data, not equations

Balance holds tunable **constants and tables**. The **shape** of a formula stays
in code. For example, defense mitigation is `raw * (1 - def/(def + K))` — the
`K` (`combat.mitigationK`) is balance; the shape lives in the dungeon's
`computeAttack`. This keeps balance a plain, safe JSON document (no expression
language, no `eval`).

## Layers (each deep-merges over the previous)

`public/balance.json` is the single source of truth. `balance.js` **imports** it
(build time) as the baseline and **re-fetches** it (runtime), so there is no
second hand-maintained copy in code.

1. **`public/balance.json`, imported** into `balance.js` at build — the baseline
   bundled into the app, so it always runs.
2. **`public/balance.json`, re-fetched** at runtime (as `dist/balance.json`), so a
   deployed build can be edited **without rebuilding** (like `config.json`).
   Same file as layer 1 unless edited post-build.
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
| `characteristics` | per-characteristic `base` + `perPoint` growth | `stats.js` `statGrowth`/`statValue` |
| `leveling` | XP curve (`xpBase`,`xpExponent`), `pointsPerLevel` | `leveling.js` |
| `upgrade` | `statMult`, `costGrowth`, `baseCost` | `items.js` (`itemStatMult`), `upgrade.js` |
| `salvage` | `rarityBase` yield per rarity | `salvage.js` |
| `combat` | weapon mults (`twoHandMult`,`dualWieldMult`,`shieldDefMult`); dungeon tuning (`mitigationK`,`minHit`,`floorGrowth`,`roomsPerFloor`,`turnMs`,`chestChance`,`enemyDropChance`,`xpPerEnemy`,`xpPerBoss`,`flatGrowth`); `enemies`/`bosses` tables | `character.js` `combatProfile`; the dungeon iframe |
| `loot` | rarity drop weights, luck warp (`luckK`), modifier tier bias (`modifierTierFraction`) | `items.js` `rollRarity`/`rarityChances`/`rollTier` |

Characteristics carry only the *growth numbers* here; their names, number format,
and the characteristic→combat `derive` map are structural and stay in
[`stats.js`](../frontend/src/game/stats.js) `STAT_DEFS`.

## Item catalogue (separate file)

Item **content** — weapons, armour, name modifiers, legendaries, and the effect
registry — is not balance; it lives in its own file,
[`public/items.json`](../frontend/public/items.json) (the single source, imported
+ re-fetched by [`game/items-data.js`](../frontend/src/game/items-data.js), with an
optional backend `/items` override), read via `getItems()`. It follows the exact
same import-baseline → runtime-file → backend → validate pattern as balance. See
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

1. Add the field to `public/balance.json` (this is both the baseline import and
   the runtime file — one edit).
2. Clamp/validate it in `validate()` in `balance.js`.
3. Read it via `getBalance().<section>.<key>` at the point of use — remove the
   hard-coded literal there.
4. If a combat/iframe value: it already ships in `init.balance`; read it in the
   dungeon's `applyBalance()` (keep a local default as the fallback).
5. If help text quotes the number, have that text read the same value so it can't
   drift.
