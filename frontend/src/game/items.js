// Item generation.
//
// Two kinds of items:
//   - Randomly generated: common / rare / epic. Built from a BASE item plus
//     name modifiers (prefixes/suffixes). Rarity sets how many modifiers:
//       common = 0, rare = 1 (prefix OR suffix), epic = 2 (prefix AND suffix).
//   - Legendary: named items with fixed stats and effects.
//
// The item CATALOGUE (bases, modifiers, legendaries, effect registry) is DATA
// and lives in game/items-data.js / public/items.json — edit that to add
// weapons/modifiers/legendaries. This module is the LOGIC: rolling, naming, the
// weapon loot rules, and effect resolution. Drop rates, luck, and the tier-roll
// bias are balance and live in game/balance.js (`loot`).
//
// A modifier is a weighted, id-keyed entry with a `names` array (one name per
// tier — its length caps the tier) and a per-tier `stats` block. Rolling it
// picks a modifier by weight, picks a tier (biased toward low tiers by
// loot.modifierTierFraction), and grants tier x the stats. So a
// { critRate: 0.5, critDmg: 1 } modifier at tier 5 gives +2.5% Crit%, +5%
// CritDmg. See docs/LOOT_RULES.md.

import { COMBAT_STATS, combatStat, formatStat } from './stats.js';
import { getBalance } from './balance.js';
import { getItems } from './items-data.js';

// Rarity order, worst -> best (used to lay out the [0,1) roll space). The
// per-rarity drop weights and the luck warp constant are balance — see
// game/balance.js `loot` (rollRarity/rarityChances read them).
// HELP COUPLING: the Luck `help` in stats.js and `stats help luck` (live odds
// via rarityChances) reflect those numbers automatically.
export const RARITY_TIERS = ['common', 'rare', 'epic', 'legendary'];

// --- helpers ---------------------------------------------------------------
const randInt = (n) => Math.floor(Math.random() * n);
const randOf = (arr) => arr[randInt(arr.length)];

function newUid() {
  return `it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Roll a modifier tier in [1, maxTier]. Each successive tier is
 * `loot.modifierTierFraction` as likely as the previous (0.5 -> weights
 * 100/50/25/12.5…), normalized over exactly the tiers the modifier defines
 * (its `names` length). f=0 always rolls tier 1; f>1 biases toward high tiers.
 */
function rollTier(maxTier) {
  const f = Math.max(0, getBalance().loot.modifierTierFraction);
  const weights = [];
  let w = 1;
  for (let t = 0; t < maxTier; t++) {
    weights.push(w);
    w *= f;
  }
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let r = Math.random() * total;
  for (let t = 0; t < maxTier; t++) {
    r -= weights[t];
    if (r < 0) return t + 1;
  }
  return maxTier;
}

/** Weighted pick from [id, def] entries by def.weight (>0). */
function pickWeighted(entries) {
  const wt = (d) => (d.weight > 0 ? d.weight : 0);
  const total = entries.reduce((s, [, d]) => s + wt(d), 0);
  if (total <= 0) return entries[randInt(entries.length)];
  let r = Math.random() * total;
  for (const e of entries) {
    r -= wt(e[1]);
    if (r < 0) return e;
  }
  return entries[entries.length - 1];
}

/**
 * Roll a rarity, warping a single [0,1) roll toward higher rarity by luck.
 * At luck 0 it reproduces the base weights exactly.
 */
export function rollRarity(luck = 0) {
  const { luckK, rarities } = getBalance().loot;
  const quality = Math.pow(Math.random(), 1 / (1 + Math.max(0, luck) * luckK));
  let cum = 0;
  for (const tier of RARITY_TIERS) {
    cum += (rarities[tier] && rarities[tier].weight) || 0;
    if (quality < cum) return tier;
  }
  return 'legendary';
}

/** P(rarity) for a given luck — handy for tuning/telemetry. */
export function rarityChances(luck = 0) {
  const { luckK, rarities } = getBalance().loot;
  const exp = 1 + Math.max(0, luck) * luckK;
  // P(quality >= t) = 1 - t^exp, evaluated at each cumulative boundary.
  let lowerCum = 0;
  const out = {};
  for (const tier of RARITY_TIERS) {
    const upperCum = lowerCum + ((rarities[tier] && rarities[tier].weight) || 0);
    const pAtLeastLower = 1 - Math.pow(lowerCum, exp); // quality >= lowerCum
    const pAtLeastUpper = upperCum >= 1 ? 0 : 1 - Math.pow(upperCum, exp);
    out[tier] = pAtLeastLower - pAtLeastUpper;
    lowerCum = upperCum;
  }
  return out;
}

/**
 * Roll one modifier from a pool ('prefix' | 'suffix'). Picks a modifier by
 * weight, then a tier by rollTier, and scales the per-tier stats by the tier.
 * `forbidStat` excludes modifiers that grant that stat (the 2H single-type
 * rule). Returns null if nothing in the pool is eligible.
 */
function makeMod(kind, forbidStat) {
  const poolMap = kind === 'prefix' ? getItems().prefixes : getItems().suffixes;
  let entries = Object.entries(poolMap || {});
  if (forbidStat) entries = entries.filter(([, d]) => !(d.stats && d.stats[forbidStat]));
  if (!entries.length) return null;
  const [id, def] = pickWeighted(entries);
  const tier = rollTier(def.names.length);
  const stats = {};
  for (const [s, v] of Object.entries(def.stats || {})) stats[s] = v * tier;
  return { id, kind, tier, name: def.names[tier - 1], stats };
}

function rollMods(rarity, forbidStat) {
  const out = [];
  const add = (kind) => {
    const m = makeMod(kind, forbidStat);
    if (m) out.push(m);
  };
  if (rarity === 'rare') add(Math.random() < 0.5 ? 'prefix' : 'suffix');
  else if (rarity === 'epic') {
    add('prefix');
    add('suffix');
  }
  return out;
}

/**
 * The damage type of an attacking weapon ('physical' | 'magical'), from the
 * item's `atkType`, falling back to its base definition, then to its stats
 * (so items saved before atkType existed still resolve). Off-hand shields never
 * attack; callers shouldn't ask, but this returns 'physical' for safety.
 */
export function weaponAtkType(item) {
  if (!item) return 'physical';
  if (item.atkType) return item.atkType;
  const cat = getItems();
  const def = cat.bases.find((b) => b.key === item.base) || cat.legendaries.find((l) => l.key === item.base);
  if (def && def.atkType) return def.atkType;
  const s = (def && def.stats) || item.stats || {};
  return (s.matt || 0) > (s.patt || 0) ? 'magical' : 'physical';
}

function mergeStats(base, mods) {
  const stats = { ...base };
  for (const m of mods) for (const [s, v] of Object.entries(m.stats || {})) stats[s] = (stats[s] || 0) + v;
  return stats;
}

function buildName(baseName, mods) {
  const prefix = mods.find((m) => m.kind === 'prefix');
  const suffix = mods.find((m) => m.kind === 'suffix');
  return [prefix && prefix.name, baseName, suffix && suffix.name].filter(Boolean).join(' ');
}

function instantiateLegendary(def) {
  const l = def || randOf(getItems().legendaries);
  const item = {
    uid: newUid(),
    base: l.key,
    name: l.name,
    slot: l.slot,
    hands: l.hands,
    rarity: 'legendary',
    mods: [],
    stats: { ...l.stats },
    // Store effect refs as authored (ids or {id,value?}); itemEffects resolves
    // them against the registry at read time.
    effects: (l.effects || []).map((e) => (typeof e === 'string' ? e : { ...e })),
  };
  if (l.atkType) item.atkType = l.atkType;
  return item;
}

/**
 * Generate an item. Pass { rarity } to force one, or { luck } to bias the roll.
 * @returns an item instance.
 */
export function generateItem(opts = {}) {
  const rarity = opts.rarity || rollRarity(opts.luck || 0);
  if (rarity === 'legendary') return instantiateLegendary(opts.legendary);

  const base = randOf(getItems().bases);
  const isWeapon = base.slot === 'weapon';
  const twoHanded = base.hands === 2;

  // LOOT RULES (see docs/LOOT_RULES.md):
  //  - A two-handed weapon is single attack-type: it never rolls a modifier that
  //    grants the OPPOSITE attack stat (a greatsword won't get M.Att, a staff
  //    won't get P.Att). One-handed weapons and armour may roll anything.
  const forbidStat = isWeapon && twoHanded ? (base.atkType === 'physical' ? 'matt' : 'patt') : null;
  let mods = rollMods(rarity, forbidStat);
  //  - A two-handed weapon carries ~2x the "extra stats" of a 1H (it uses both
  //    weapon slots), so every stat its modifiers grant is doubled.
  if (isWeapon && twoHanded) {
    mods = mods.map((m) => {
      const stats = {};
      for (const [s, v] of Object.entries(m.stats)) stats[s] = v * 2;
      return { ...m, stats };
    });
  }

  const item = {
    uid: newUid(),
    base: base.key,
    name: buildName(base.name, mods),
    slot: base.slot,
    hands: base.hands,
    rarity,
    mods: mods.map((m) => ({ id: m.id, kind: m.kind, tier: m.tier, name: m.name, stats: { ...m.stats } })),
    stats: mergeStats(base.stats, mods),
  };
  if (isWeapon && base.atkType) item.atkType = base.atkType;
  // A base item may grant effects (by id) to every instance it rolls — the same
  // effect system legendaries use. itemEffects resolves these at read time.
  if (Array.isArray(base.effects) && base.effects.length) {
    item.effects = base.effects.map((e) => (typeof e === 'string' ? e : { ...e }));
  }
  return item;
}

/**
 * The resolved effects of an item as structured descriptors. Each source ref is
 * a bare id string or an object ({ id, value?, desc? }); it's resolved against
 * the effect registry (items-data.js `effects`) so a ref can be just an id.
 * Reads the instance's `effects`, falling back to the item's base/legendary
 * definition by key — so old saves (which stored full effect objects) and new
 * id-only refs both work.
 * @returns {Array<{id:string,value?:number,desc:string}>}
 */
export function itemEffects(item) {
  if (!item) return [];
  const cat = getItems();
  const registry = cat.effects || {};
  const resolve = (e) => {
    const id = typeof e === 'string' ? e : e && e.id;
    if (!id) return null;
    const reg = registry[id] || {};
    const obj = typeof e === 'object' && e ? e : {};
    const value = obj.value != null ? obj.value : reg.value;
    const desc = obj.desc || reg.desc || id;
    return value != null ? { id, value, desc } : { id, desc };
  };

  let refs = Array.isArray(item.effects) ? item.effects : null;
  if (!refs) {
    // Fall back to the definition by base key (covers items that don't carry
    // their own effects, e.g. an older save missing the field).
    const def = cat.legendaries.find((l) => l.key === item.base) || cat.bases.find((b) => b.key === item.base);
    if (def && Array.isArray(def.effects)) refs = def.effects;
  }
  return (refs || []).map(resolve).filter(Boolean);
}

// --- Upgrades --------------------------------------------------------------
// Equipment can be upgraded (see game/upgrade.js). An upgrade multiplies ALL of
// the item's stats by the balance `upgrade.statMult` per level; the level is
// stored on the item as `upgrade` (missing = 0) and shown after the name "+N".
// The stat multiplier and the cost constants both live in game/balance.js
// (`upgrade` section) — the single source for the upgrade economy.

/** The upgrade level of an item (0 for un-upgraded or non-weapon items). */
export function itemUpgradeLevel(item) {
  return Math.max(0, Math.floor((item && item.upgrade) || 0));
}

/** The stat multiplier from an item's upgrade level: statMult^level. */
export function itemStatMult(item) {
  return Math.pow(getBalance().upgrade.statMult, itemUpgradeLevel(item));
}

/**
 * An item's stats after its upgrade multiplier, rounded per stat format
 * (integers for int stats, one decimal for percentages). This is what combat
 * and the equipment screens should read — `item.stats` is the un-upgraded base.
 */
export function effectiveItemStats(item) {
  const mult = itemStatMult(item);
  const stats = (item && item.stats) || {};
  const out = {};
  for (const [k, v] of Object.entries(stats)) {
    const def = combatStat(k);
    const scaled = v * mult;
    out[k] = def && def.fmt === 'pct' ? Math.round(scaled * 10) / 10 : Math.round(scaled);
  }
  return out;
}

/** Display name including the "+N" upgrade suffix. */
export function itemDisplayName(item) {
  const lvl = itemUpgradeLevel(item);
  return lvl ? `${item.name} +${lvl}` : item.name;
}

/** Rarity ordering for sorting (best first). */
export const RARITY_RANK = { legendary: 0, epic: 1, rare: 2, common: 3 };

/** Sort comparator: by rarity (best first), then name A–Z. */
export function compareItems(a, b) {
  const ra = RARITY_RANK[a.rarity] ?? 9;
  const rb = RARITY_RANK[b.rarity] ?? 9;
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name);
}

/** A compact "+5 P.Att, +2 Speed" summary of an item's stats (post-upgrade). */
export function describeStats(item) {
  const eff = effectiveItemStats(item);
  return COMBAT_STATS.filter((d) => eff[d.id])
    .map((d) => `+${formatStat(d, eff[d.id]).replace('%', '')}${d.fmt === 'pct' ? '%' : ''} ${d.abbr}`)
    .join(', ');
}

/** Lines for `help items`: every modifier, its tier names, and per-tier stats. */
export function modifierHelpLines() {
  const lines = [];
  const statDef = (id) => combatStat(id);
  const perTier = (stats) =>
    Object.entries(stats || {})
      .map(([s, v]) => {
        const d = statDef(s);
        return d ? `+${formatStat(d, v).replace('%', '')}${d.fmt === 'pct' ? '%' : ''} ${d.abbr}` : `+${v} ${s}`;
      })
      .join(', ');
  const dump = (label, pool) => {
    lines.push(label);
    for (const [, m] of Object.entries(pool || {})) {
      lines.push(`  ${m.names.join(' / ')}  —  ${perTier(m.stats)} per tier`);
    }
  };
  const { prefixes, suffixes } = getItems();
  dump('PREFIXES (before the name; one name per tier):', prefixes);
  dump('SUFFIXES (after the name; one name per tier):', suffixes);
  return lines;
}
