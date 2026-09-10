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

// --- catalogue lookups -----------------------------------------------------
/** The base/legendary definition for an item, from the live catalogue. */
function baseDef(item) {
  const cat = getItems();
  return cat.bases.find((b) => b.key === item.base) || cat.legendaries.find((l) => l.key === item.base) || null;
}
/** A modifier definition by kind + id, from the live catalogue. */
function modDef(kind, id) {
  const pool = kind === 'prefix' ? getItems().prefixes : getItems().suffixes;
  return pool ? pool[id] : undefined;
}

// --- generation (produces a RECIPE, not baked stats) -----------------------
/**
 * Roll one modifier RECIPE ({ id, kind, tier }) from a pool. Picks by weight,
 * then a tier by rollTier. `forbidStat` excludes modifiers that grant that stat
 * (the 2H single-type rule). Returns null if nothing in the pool is eligible.
 * The stats/name are NOT baked — they're read from the catalogue at compute time.
 */
function rollModRecipe(kind, forbidStat) {
  const poolMap = kind === 'prefix' ? getItems().prefixes : getItems().suffixes;
  let entries = Object.entries(poolMap || {});
  if (forbidStat) entries = entries.filter(([, d]) => !(d.stats && d.stats[forbidStat]));
  if (!entries.length) return null;
  const [id, def] = pickWeighted(entries);
  return { id, kind, tier: rollTier(def.names.length) };
}

function rollMods(rarity, forbidStat) {
  const out = [];
  const add = (kind) => {
    const m = rollModRecipe(kind, forbidStat);
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
 * Generate an item as a RECIPE: base key, rarity, slot/hands/atkType (identity),
 * upgrade level, and modifier refs ({ id, kind, tier }). Its name and stats are
 * NOT baked — they're computed live from the catalogue (itemName / itemStats),
 * so editing items.json / balance.json retroactively rebalances existing items.
 * Pass { rarity } to force one, or { luck } to bias the roll.
 */
export function generateItem(opts = {}) {
  const rarity = opts.rarity || rollRarity(opts.luck || 0);
  const cat = getItems();

  if (rarity === 'legendary') {
    const l = opts.legendary || randOf(cat.legendaries);
    const item = { uid: newUid(), base: l.key, rarity: 'legendary', slot: l.slot, upgrade: 0, mods: [] };
    if (l.hands != null) item.hands = l.hands;
    if (l.atkType) item.atkType = l.atkType;
    return item;
  }

  const base = randOf(cat.bases);
  const isWeapon = base.slot === 'weapon';
  const twoHanded = base.hands === 2;
  // LOOT RULES (docs/LOOT_RULES.md): a two-handed weapon is single attack-type —
  // it never rolls a modifier granting the OPPOSITE attack stat. (Its ~2x "extra
  // stats" is applied when stats are computed; see itemStats.)
  const forbidStat = isWeapon && twoHanded ? (base.atkType === 'physical' ? 'matt' : 'patt') : null;
  const item = { uid: newUid(), base: base.key, rarity, slot: base.slot, upgrade: 0, mods: rollMods(rarity, forbidStat) };
  if (base.hands != null) item.hands = base.hands;
  if (isWeapon && base.atkType) item.atkType = base.atkType;
  return item;
}

// --- live resolution (computed from the catalogue) -------------------------
/**
 * An item's PRE-UPGRADE stats, computed live: base stats + each modifier's
 * per-tier stats x its rolled tier. Two-handed weapons double their MODIFIER
 * contributions (their base attack is already ~2x a 1H's). Unknown base/modifier
 * ids (e.g. removed from the catalogue) simply contribute nothing.
 */
export function itemStats(item) {
  if (!item) return {};
  const twoHanded = item.slot === 'weapon' && item.hands === 2;
  const out = {};
  const add = (map, mult) => {
    for (const [s, v] of Object.entries(map || {})) out[s] = (out[s] || 0) + v * mult;
  };
  const def = baseDef(item);
  if (def) add(def.stats, 1);
  for (const m of item.mods || []) {
    const md = modDef(m.kind, m.id);
    if (md) add(md.stats, (m.tier || 1) * (twoHanded ? 2 : 1));
  }
  return out;
}

/**
 * The item's display name, computed live: prefix + base + suffix (a legendary is
 * just its own name). Missing catalogue entries are skipped.
 */
export function itemName(item) {
  if (!item) return '';
  const def = baseDef(item);
  const baseName = def ? def.name : item.base;
  if (item.rarity === 'legendary') return baseName;
  let prefix;
  let suffix;
  for (const m of item.mods || []) {
    const md = modDef(m.kind, m.id);
    if (!md || !md.names || !md.names.length) continue;
    const nm = md.names[Math.min((m.tier || 1) - 1, md.names.length - 1)];
    if (m.kind === 'prefix') prefix = nm;
    else suffix = nm;
  }
  return [prefix, baseName, suffix].filter(Boolean).join(' ');
}

/**
 * The damage type of an attacking weapon ('physical' | 'magical'), from the
 * item's stored atkType, falling back to its base definition, then its stats.
 */
export function weaponAtkType(item) {
  if (!item) return 'physical';
  if (item.atkType) return item.atkType;
  const def = baseDef(item);
  if (def && def.atkType) return def.atkType;
  const s = (def && def.stats) || {};
  return (s.matt || 0) > (s.patt || 0) ? 'magical' : 'physical';
}

/**
 * The resolved effects of an item, computed from the catalogue (base/legendary
 * `effects` by base key) via the effect registry. An item may also carry its own
 * `effects` refs (older saves / custom); those take precedence.
 * @returns {Array<{id:string,value?:number,desc:string}>}
 */
export function itemEffects(item) {
  if (!item) return [];
  const cat = getItems();
  const registry = cat.effects || {};
  const def = cat.legendaries.find((l) => l.key === item.base) || cat.bases.find((b) => b.key === item.base);
  const refs = Array.isArray(item.effects) ? item.effects : def && Array.isArray(def.effects) ? def.effects : [];
  return refs
    .map((e) => {
      const id = typeof e === 'string' ? e : e && e.id;
      if (!id) return null;
      const reg = registry[id] || {};
      const obj = typeof e === 'object' && e ? e : {};
      const value = obj.value != null ? obj.value : reg.value;
      const desc = obj.desc || reg.desc || id;
      return value != null ? { id, value, desc } : { id, desc };
    })
    .filter(Boolean);
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
 * An item's effective combat stats: its live catalogue stats (itemStats) times
 * the upgrade multiplier, rounded per stat format (integers for int stats, one
 * decimal for percentages). This is what combat and the equipment screens read.
 */
export function effectiveItemStats(item) {
  const mult = itemStatMult(item);
  const out = {};
  for (const [k, v] of Object.entries(itemStats(item))) {
    const def = combatStat(k);
    const scaled = v * mult;
    out[k] = def && def.fmt === 'pct' ? Math.round(scaled * 10) / 10 : Math.round(scaled);
  }
  return out;
}

/** Display name including the "+N" upgrade suffix. */
export function itemDisplayName(item) {
  const lvl = itemUpgradeLevel(item);
  const nm = itemName(item);
  return lvl ? `${nm} +${lvl}` : nm;
}

/** Rarity ordering for sorting (best first). */
export const RARITY_RANK = { legendary: 0, epic: 1, rare: 2, common: 3 };

/** Sort comparator: by rarity (best first), then name A–Z. */
export function compareItems(a, b) {
  const ra = RARITY_RANK[a.rarity] ?? 9;
  const rb = RARITY_RANK[b.rarity] ?? 9;
  if (ra !== rb) return ra - rb;
  return itemName(a).localeCompare(itemName(b));
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
