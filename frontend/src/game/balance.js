// Central game-balance tunables.
//
// GOAL: every balance NUMBER (stat growth, drop rates, costs, multipliers, …)
// lives in one place so it can be retuned without hunting through the code, and
// optionally overridden per deployment.
//
// LAYERS (each overrides the previous, deep-merged):
//   1. DEFAULT_BALANCE below — the embedded fallback; the game always works.
//   2. public/balance.json   — bundled with the build, editable post-build (so a
//      local host can tweak balance without rebuilding). Copied verbatim into
//      dist/ like config.json.
//   3. `${apiBase}/balance`   — if a backend is configured, its balance wins, so
//      two backends can serve different numbers. (The endpoint is a stub today;
//      an unreachable/404 backend simply leaves layers 1–2 in effect.)
//
// SCOPE: this holds tunable CONSTANTS and TABLES, not equations. The *shape* of
// a formula stays in code (e.g. def/(def+50)); only its parameters live here.
// See docs/BALANCE.md.
//
// Consumers read values at call time via getBalance(), so a reload/override
// takes effect without re-importing modules. loadBalance() must resolve before
// the UI computes anything (main.js awaits it right after loadConfig).

import { getConfig } from '../config.js';

/** The embedded fallback — also the schema/reference for balance.json. */
export const DEFAULT_BALANCE = {
  balanceVersion: 1,

  // Global leveling. xpForLevel(level) = floor(xpBase * level^xpExponent).
  leveling: {
    xpBase: 100,
    xpExponent: 1.1,
    pointsPerLevel: 5,
  },

  // Equipment upgrades (+N). stats x statMult^N; material cost
  // baseCost * costGrowth^N, in the item's orientation resource.
  upgrade: {
    statMult: 1.2,
    costGrowth: 1.5,
    baseCost: 10,
  },

  // Salvage yield. Base resource units per rarity, before the orientation split
  // and the small per-stat-total bonus (see game/salvage.js).
  salvage: {
    rarityBase: { common: 2, rare: 6, epic: 15, legendary: 40 },
  },

  // Combat. The weapon multipliers feed character.js combatProfile(); the rest
  // is the dungeon's tuning and is SENT TO THE IFRAME via the bridge init (the
  // dungeon is sandboxed and can't import this module). Formula shapes stay in
  // the dungeon; only these parameters live here.
  combat: {
    twoHandMult: 1.3, // one-attack multiplier for a two-handed weapon
    dualWieldMult: 0.6, // per-weapon multiplier when dual-wielding one-handers
    shieldDefMult: 1.2, // defense multiplier from an off-hand shield
    mitigationK: 50, // damage taken = raw * (1 - def/(def + K))
    minHit: 0.1, // hit chance floor (dodge can't drop you below this)
    roomsPerFloor: 6, // last room of a floor is the boss
    floorGrowth: 0.15, // enemy power stats grow this fraction per floor
    turnMs: 1000, // real-time ms per combat turn
    chestChance: 0.22, // chance a non-boss room is a treasure chest
    enemyDropChance: 0.35, // chance a normal enemy drops gear
    xpPerEnemy: 10, // * floor
    xpPerBoss: 60, // * floor
    // Additive per-level growth for enemy RATING stats (power stats scale by
    // floorGrowth instead). value = base + growth * (floor - 1).
    flatGrowth: { acc: 1, critRate: 0.2, critDmg: 1, luck: 0 },
    // Enemy archetypes at base (level-1) stats.
    enemies: [
      { name: 'Slime', hp: 40, patt: 6, matt: 0, pdef: 2, mdef: 2, speed: 5, acc: 90, dodge: 10, critRate: 2, critDmg: 150, luck: 1 },
      { name: 'Goblin', hp: 50, patt: 9, matt: 0, pdef: 3, mdef: 2, speed: 9, acc: 90, dodge: 18, critRate: 5, critDmg: 150, luck: 2 },
      { name: 'Bat', hp: 30, patt: 7, matt: 0, pdef: 1, mdef: 1, speed: 14, acc: 90, dodge: 30, critRate: 8, critDmg: 150, luck: 3 },
      { name: 'Skeleton', hp: 60, patt: 11, matt: 0, pdef: 5, mdef: 1, speed: 7, acc: 90, dodge: 12, critRate: 5, critDmg: 150, luck: 1 },
      { name: 'Acolyte', hp: 45, patt: 0, matt: 12, pdef: 2, mdef: 5, speed: 8, acc: 90, dodge: 15, critRate: 5, critDmg: 150, luck: 2 },
    ],
    bosses: [
      { name: 'Ogre', hp: 120, patt: 16, matt: 0, pdef: 6, mdef: 4, speed: 6, acc: 90, dodge: 12, critRate: 5, critDmg: 160, luck: 3 },
      { name: 'Dark Mage', hp: 100, patt: 0, matt: 20, pdef: 4, mdef: 8, speed: 9, acc: 90, dodge: 18, critRate: 8, critDmg: 160, luck: 4 },
      { name: 'Dragonling', hp: 150, patt: 18, matt: 10, pdef: 8, mdef: 6, speed: 10, acc: 90, dodge: 22, critRate: 10, critDmg: 175, luck: 5 },
    ],
  },

  // Loot rolling. `weight` is each rarity's base drop chance at luck 0 (they sum
  // to 1); Luck warps a single roll toward higher rarity by luckK. The number of
  // name modifiers per rarity (common 0 / rare 1 / epic 2 / legendary unique) is
  // structural and lives in items.js. The item CATALOGUE (weapons, modifiers,
  // legendaries, effects) is separate content — see game/items-data.js /
  // public/items.json.
  loot: {
    luckK: 0.009,
    rarities: {
      common: { weight: 0.749 },
      rare: { weight: 0.2 },
      epic: { weight: 0.05 },
      legendary: { weight: 0.001 },
    },
  },
};

// Enemy/boss stat fields sanitized when validating externally-sourced tables.
const UNIT_FIELDS = ['hp', 'patt', 'matt', 'pdef', 'mdef', 'speed', 'acc', 'dodge', 'critRate', 'critDmg', 'luck'];

/** Sanitize an enemy table: keep it only if it's a non-empty array of units. */
function sanitizeUnits(arr, def) {
  if (!Array.isArray(arr) || arr.length === 0) return def.map((u) => ({ ...u }));
  return arr.map((u, i) => {
    const src = isPlainObject(u) ? u : {};
    const out = { name: typeof src.name === 'string' && src.name ? src.name : `Enemy ${i + 1}` };
    for (const f of UNIT_FIELDS) out[f] = num(src[f], 0, { min: 0 });
    return out;
  });
}

let current = clone(DEFAULT_BALANCE);

/** Synchronous access to the active balance (defaults until loadBalance runs). */
export function getBalance() {
  return current;
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge `over` onto `base`: objects merge; arrays/primitives replace. */
function deepMerge(base, over) {
  if (!isPlainObject(over)) return over;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const k of Object.keys(over)) out[k] = deepMerge(out[k], over[k]);
  return out;
}

/** Coerce to a finite number in [min,max], else fall back to `d`. */
function num(v, d, { min = -Infinity, max = Infinity } = {}) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
}

/**
 * Rebuild a known-good balance object from `raw`, clamping every field to the
 * default when it's missing or invalid. This is the trust boundary for the
 * bundled file and (especially) any backend-served balance — a malformed value
 * can never crash the game or produce an absurd state.
 */
function validate(raw) {
  const d = DEFAULT_BALANCE;
  const b = isPlainObject(raw) ? raw : {};
  const L = isPlainObject(b.leveling) ? b.leveling : {};
  const U = isPlainObject(b.upgrade) ? b.upgrade : {};
  const S = isPlainObject(b.salvage) && isPlainObject(b.salvage.rarityBase) ? b.salvage.rarityBase : {};
  const sBase = d.salvage.rarityBase;
  const C = isPlainObject(b.combat) ? b.combat : {};
  const dc = d.combat;
  const FG = isPlainObject(C.flatGrowth) ? C.flatGrowth : {};
  const Lo = isPlainObject(b.loot) ? b.loot : {};
  const LoR = isPlainObject(Lo.rarities) ? Lo.rarities : {};
  const dr = d.loot.rarities;
  const rw = (t) => ({ weight: num(isPlainObject(LoR[t]) ? LoR[t].weight : undefined, dr[t].weight, { min: 0 }) });
  return {
    balanceVersion: num(b.balanceVersion, d.balanceVersion, { min: 1 }),
    leveling: {
      xpBase: num(L.xpBase, d.leveling.xpBase, { min: 1 }),
      xpExponent: num(L.xpExponent, d.leveling.xpExponent, { min: 0 }),
      pointsPerLevel: Math.floor(num(L.pointsPerLevel, d.leveling.pointsPerLevel, { min: 0 })),
    },
    upgrade: {
      statMult: num(U.statMult, d.upgrade.statMult, { min: 1 }),
      costGrowth: num(U.costGrowth, d.upgrade.costGrowth, { min: 1 }),
      baseCost: num(U.baseCost, d.upgrade.baseCost, { min: 0 }),
    },
    salvage: {
      rarityBase: {
        common: num(S.common, sBase.common, { min: 0 }),
        rare: num(S.rare, sBase.rare, { min: 0 }),
        epic: num(S.epic, sBase.epic, { min: 0 }),
        legendary: num(S.legendary, sBase.legendary, { min: 0 }),
      },
    },
    combat: {
      twoHandMult: num(C.twoHandMult, dc.twoHandMult, { min: 0 }),
      dualWieldMult: num(C.dualWieldMult, dc.dualWieldMult, { min: 0 }),
      shieldDefMult: num(C.shieldDefMult, dc.shieldDefMult, { min: 1 }),
      mitigationK: num(C.mitigationK, dc.mitigationK, { min: 1 }),
      minHit: num(C.minHit, dc.minHit, { min: 0, max: 1 }),
      roomsPerFloor: Math.floor(num(C.roomsPerFloor, dc.roomsPerFloor, { min: 1 })),
      floorGrowth: num(C.floorGrowth, dc.floorGrowth, { min: 0 }),
      turnMs: num(C.turnMs, dc.turnMs, { min: 50 }),
      chestChance: num(C.chestChance, dc.chestChance, { min: 0, max: 1 }),
      enemyDropChance: num(C.enemyDropChance, dc.enemyDropChance, { min: 0, max: 1 }),
      xpPerEnemy: num(C.xpPerEnemy, dc.xpPerEnemy, { min: 0 }),
      xpPerBoss: num(C.xpPerBoss, dc.xpPerBoss, { min: 0 }),
      flatGrowth: {
        acc: num(FG.acc, dc.flatGrowth.acc, { min: 0 }),
        critRate: num(FG.critRate, dc.flatGrowth.critRate, { min: 0 }),
        critDmg: num(FG.critDmg, dc.flatGrowth.critDmg, { min: 0 }),
        luck: num(FG.luck, dc.flatGrowth.luck, { min: 0 }),
      },
      enemies: sanitizeUnits(C.enemies, dc.enemies),
      bosses: sanitizeUnits(C.bosses, dc.bosses),
    },
    loot: {
      luckK: num(Lo.luckK, d.loot.luckK, { min: 0 }),
      rarities: {
        common: rw('common'),
        rare: rw('rare'),
        epic: rw('epic'),
        legendary: rw('legendary'),
      },
    },
  };
}

/**
 * Resolve the active balance: embedded default, then the bundled balance.json,
 * then a configured backend's /balance. Always resolves (falls back cleanly) so
 * the game boots regardless. Call once at startup, before rendering.
 */
export async function loadBalance() {
  let raw = clone(DEFAULT_BALANCE);

  // Layer 2: bundled file (respects Vite's base path, like config.json).
  try {
    const url = `${import.meta.env.BASE_URL}balance.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) raw = deepMerge(raw, await res.json());
    else if (res.status !== 404) throw new Error(`balance.json HTTP ${res.status}`);
  } catch (err) {
    console.warn('[balance] Using built-in defaults for balance.json:', err.message);
  }

  // Layer 3: backend override, if one is configured. Optional — a missing or
  // stubbed endpoint just leaves the local balance in place.
  const { apiBase } = getConfig();
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase.replace(/\/$/, '')}/balance`, { cache: 'no-store' });
      if (res.ok) raw = deepMerge(raw, await res.json());
    } catch {
      /* backend is optional; keep local balance */
    }
  }

  current = validate(raw);
  return current;
}
