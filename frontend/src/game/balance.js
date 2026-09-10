// Central game-balance tunables.
//
// GOAL: every balance NUMBER (character growth, drop rates, costs, multipliers,
// enemy tables, …) lives in ONE place — public/balance.json — so it can be
// retuned without touching code, and optionally overridden per deployment.
//
// public/balance.json is imported here at build time as the baseline AND
// re-fetched at runtime by loadBalance(), so post-build edits to dist/balance.json
// and an optional backend /balance override take effect without a rebuild. There
// is no second hand-maintained copy in code.
//   - runtime file:   public/balance.json  (edit dist/balance.json post-build)
//   - backend wins:   `${apiBase}/balance`  (stub today; unreachable = ignored)
//
// SCOPE: tunable CONSTANTS and TABLES, not equations. The *shape* of a formula
// stays in code (e.g. def/(def+K)); only its parameters live in the JSON. See
// docs/BALANCE.md.
//
// Consumers read values at call time via getBalance(), so a reload/override
// takes effect without re-importing modules. loadBalance() must resolve before
// the UI computes anything (main.js awaits it right after loadConfig).

import { getConfig } from '../config.js';
// The single source of truth for balance. Imported (build-time) as the baseline;
// re-fetched at runtime by loadBalance() for post-build / backend overrides.
import DEFAULT_BALANCE from '../../public/balance.json';

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
  const Ch = isPlainObject(b.characteristics) ? b.characteristics : {};
  const dch = isPlainObject(d.characteristics) ? d.characteristics : {};
  const characteristics = {};
  for (const id of Object.keys(dch)) {
    const o = isPlainObject(Ch[id]) ? Ch[id] : {};
    characteristics[id] = {
      base: num(o.base, dch[id].base),
      perPoint: num(o.perPoint, dch[id].perPoint),
    };
  }
  return {
    balanceVersion: num(b.balanceVersion, d.balanceVersion, { min: 1 }),
    characteristics,
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
      modifierTierFraction: num(Lo.modifierTierFraction, d.loot.modifierTierFraction, { min: 0 }),
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
