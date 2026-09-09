// Item data + generation.
//
// Two kinds of items:
//   - Randomly generated: common / rare / epic. Built from a BASE item plus
//     name modifiers (prefixes/suffixes). Rarity sets how many modifiers:
//       common = 0, rare = 1 (prefix OR suffix), epic = 2 (prefix AND suffix).
//   - Legendary: hand-authored named items with fixed stats and unique effects.
//
// A modifier is tied to one stat and has 3 tiers. Its stat boost is derived, not
// hard-coded: value = (that stat's perPoint) * tier. So tier 1/2/3 of a luck
// modifier gives +1/+2/+3, of an HP modifier +10/+20/+30, etc. — matching the
// allocation scale in stats.js and keeping everything easy to rebalance/graph.

import { STAT_DEFS, formatStat } from './stats.js';

const PER_POINT = Object.fromEntries(STAT_DEFS.map((d) => [d.id, d.perPoint]));

// Rarity metadata. `weight` is the base drop chance at luck 0 (they sum to 1).
// `mods` is how many name modifiers the rarity rolls.
export const RARITIES = {
  common: { label: 'Common', mods: 0, weight: 0.749 },
  rare: { label: 'Rare', mods: 1, weight: 0.2 },
  epic: { label: 'Epic', mods: 2, weight: 0.05 },
  legendary: { label: 'Legendary', mods: 0, weight: 0.001 },
};

// Rarity order, worst -> best (used to lay out the [0,1) roll space).
export const RARITY_TIERS = ['common', 'rare', 'epic', 'legendary'];

// Luck warps a single [0,1) roll toward higher rarity:
//   quality = roll ^ (1 / (1 + luck * LUCK_K))
// which raises the chance of landing in the high-rarity bands. LUCK_K is tuned
// so ~luck 1000 gives ~1% legendary (from a 0.1% base). Bump it to make luck
// pay off faster.
// HELP COUPLING: the Luck `help` in stats.js describes this, and `stats help
// luck` prints live odds via rarityChances(). The base rates above are also
// quoted there — keep them in sync if you retune weights or LUCK_K.
export const LUCK_K = 0.009;

// Base items. `slot` is the equip slot; weapons use slot 'weapon' with `hands`:
// 1 (one-handed), 2 (two-handed), or 'off' (off-hand, e.g. a shield).
export const BASE_ITEMS = [
  { key: 'sword', name: 'Sword', slot: 'weapon', hands: 1, base: { patt: 5 } },
  { key: 'dagger', name: 'Dagger', slot: 'weapon', hands: 1, base: { patt: 3, speed: 2 } },
  { key: 'wand', name: 'Wand', slot: 'weapon', hands: 1, base: { matt: 5 } },
  { key: 'greatsword', name: 'Greatsword', slot: 'weapon', hands: 2, base: { patt: 12 } },
  { key: 'staff', name: 'Staff', slot: 'weapon', hands: 2, base: { matt: 12 } },
  { key: 'shield', name: 'Shield', slot: 'weapon', hands: 'off', base: { pdef: 5, hp: 20 } },
  { key: 'helmet', name: 'Helmet', slot: 'head', base: { pdef: 2, mdef: 2 } },
  { key: 'chestplate', name: 'Chestplate', slot: 'chest', base: { pdef: 4, hp: 30 } },
  { key: 'gauntlets', name: 'Gauntlets', slot: 'hands', base: { patt: 2, pdef: 1 } },
  { key: 'greaves', name: 'Greaves', slot: 'legs', base: { pdef: 3 } },
  { key: 'boots', name: 'Boots', slot: 'feet', base: { speed: 3 } },
];

// Modifier names, keyed by stat id; index 0/1/2 = tier 1/2/3.
export const PREFIXES = {
  hp: ['Hearty', 'Robust', 'Titanic'],
  patt: ['Sharp', 'Keen', 'Brutal'],
  matt: ['Mystic', 'Arcane', 'Eldritch'],
  pdef: ['Sturdy', 'Plated', 'Impregnable'],
  mdef: ['Warded', 'Runed', 'Hallowed'],
  speed: ['Swift', 'Fleet', 'Blurring'],
  acc: ['Precise', 'Keeneye', 'Unerring'],
  dodge: ['Nimble', 'Evasive', 'Ghostly'],
  critRate: ['Deadly', 'Lethal', 'Murderous'],
  critDmg: ['Vicious', 'Savage', 'Cataclysmic'],
  luck: ['Lucky', 'Fortunate', 'Blessed'],
};
export const SUFFIXES = {
  hp: ['of Vigor', 'of Vitality', 'of the Colossus'],
  patt: ['of Might', 'of Power', 'of Devastation'],
  matt: ['of Magic', 'of Sorcery', 'of the Archmage'],
  pdef: ['of Protection', 'of the Bulwark', 'of the Aegis'],
  mdef: ['of Warding', 'of Spellguard', 'of the Sanctum'],
  speed: ['of Haste', 'of Alacrity', 'of the Gale'],
  acc: ['of Aim', 'of Precision', 'of the Hawk'],
  dodge: ['of Evasion', 'of the Fox', 'of Shadows'],
  critRate: ['of Striking', 'of the Assassin', 'of Slaughter'],
  critDmg: ['of Ruin', 'of Carnage', 'of Annihilation'],
  luck: ['of Luck', 'of Fortune', 'of Destiny'],
};

// Named legendary items — fixed stats and structured unique effects.
// An effect is data the combat engine can act on: { id, value?, desc }.
// See minigames/dungeon for the combat hooks that implement each id.
export const LEGENDARIES = [
  {
    key: 'excalibur',
    name: 'Excalibur',
    slot: 'weapon',
    hands: 2,
    stats: { patt: 25, critRate: 10 },
    effects: [{ id: 'ignoreDefense', value: 0.3, desc: 'Radiant Edge — ignores 30% of enemy defense.' }],
  },
  {
    key: 'aegis',
    name: 'Aegis of the Ancients',
    slot: 'weapon',
    hands: 'off',
    stats: { pdef: 15, mdef: 15, hp: 50 },
    effects: [{ id: 'firstHitShield', desc: 'Bulwark — negates the first hit each battle.' }],
  },
  {
    key: 'sandals',
    name: "Hermes' Sandals",
    slot: 'feet',
    stats: { speed: 15, acc: 5 },
    effects: [{ id: 'alwaysFirst', desc: 'Fleetfooted — you always act first.' }],
  },
];

// --- helpers ---------------------------------------------------------------
const randInt = (n) => Math.floor(Math.random() * n);
const randOf = (arr) => arr[randInt(arr.length)];
const STAT_IDS = STAT_DEFS.map((d) => d.id);

function newUid() {
  return `it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** The stat value a modifier grants: perPoint * tier. */
export function modifierValue(statId, tier) {
  return (PER_POINT[statId] || 0) * tier;
}

/**
 * Roll a rarity, warping a single [0,1) roll toward higher rarity by luck.
 * At luck 0 it reproduces the base weights exactly.
 */
export function rollRarity(luck = 0) {
  const quality = Math.pow(Math.random(), 1 / (1 + Math.max(0, luck) * LUCK_K));
  let cum = 0;
  for (const tier of RARITY_TIERS) {
    cum += RARITIES[tier].weight;
    if (quality < cum) return tier;
  }
  return 'legendary';
}

/** P(rarity) for a given luck — handy for tuning/telemetry. */
export function rarityChances(luck = 0) {
  const exp = 1 + Math.max(0, luck) * LUCK_K;
  // P(quality >= t) = 1 - t^exp, evaluated at each cumulative boundary.
  let lowerCum = 0;
  const out = {};
  for (const tier of RARITY_TIERS) {
    const upperCum = lowerCum + RARITIES[tier].weight;
    const pAtLeastLower = 1 - Math.pow(lowerCum, exp); // quality >= lowerCum
    const pAtLeastUpper = upperCum >= 1 ? 0 : 1 - Math.pow(upperCum, exp);
    out[tier] = pAtLeastLower - pAtLeastUpper;
    lowerCum = upperCum;
  }
  return out;
}

function makeMod(kind) {
  const statId = randOf(STAT_IDS);
  const tier = randInt(3) + 1; // 1..3
  const names = kind === 'prefix' ? PREFIXES : SUFFIXES;
  return { statId, kind, tier, name: names[statId][tier - 1], value: modifierValue(statId, tier) };
}

function rollMods(rarity) {
  if (rarity === 'rare') return [makeMod(Math.random() < 0.5 ? 'prefix' : 'suffix')];
  if (rarity === 'epic') return [makeMod('prefix'), makeMod('suffix')];
  return [];
}

function mergeStats(base, mods) {
  const stats = { ...base };
  for (const m of mods) stats[m.statId] = (stats[m.statId] || 0) + m.value;
  return stats;
}

function buildName(baseName, mods) {
  const prefix = mods.find((m) => m.kind === 'prefix');
  const suffix = mods.find((m) => m.kind === 'suffix');
  return [prefix && prefix.name, baseName, suffix && suffix.name].filter(Boolean).join(' ');
}

function instantiateLegendary(def) {
  const l = def || randOf(LEGENDARIES);
  return {
    uid: newUid(),
    base: l.key,
    name: l.name,
    slot: l.slot,
    hands: l.hands,
    rarity: 'legendary',
    mods: [],
    stats: { ...l.stats },
    effects: (l.effects || []).map((e) => ({ ...e })),
  };
}

/**
 * Generate an item. Pass { rarity } to force one, or { luck } to bias the roll.
 * @returns an item instance.
 */
export function generateItem(opts = {}) {
  const rarity = opts.rarity || rollRarity(opts.luck || 0);
  if (rarity === 'legendary') return instantiateLegendary(opts.legendary);

  const base = randOf(BASE_ITEMS);
  const mods = rollMods(rarity);
  return {
    uid: newUid(),
    base: base.key,
    name: buildName(base.name, mods),
    slot: base.slot,
    hands: base.hands,
    rarity,
    mods: mods.map((m) => ({ statId: m.statId, kind: m.kind, tier: m.tier, name: m.name, value: m.value })),
    stats: mergeStats(base.base, mods),
  };
}

/**
 * The structured effects of an item. Reads the instance's `effects`, falling
 * back to the legendary definition by base key — so items saved before effects
 * were structured (or that only carry the old `effect` string) still work.
 * @returns {Array<{id:string,value?:number,desc:string}>}
 */
export function itemEffects(item) {
  if (!item) return [];
  if (Array.isArray(item.effects)) return item.effects;
  if (item.rarity === 'legendary') {
    const def = LEGENDARIES.find((l) => l.key === item.base);
    if (def && def.effects) return def.effects;
  }
  return [];
}

// --- Upgrades --------------------------------------------------------------
// Weapons can be upgraded (see game/upgrade.js). An upgrade multiplies ALL of
// the item's stats by UPGRADE_STAT_MULT per level; the level is stored on the
// item as `upgrade` (missing = 0) and shown after the name as "+N".
// HELP COUPLING: UPGRADE_STAT_MULT is the stat side of the upgrade economy; the
// cost side (UPGRADE_COST_GROWTH / UPGRADE_BASE_COST / legendary duplicates)
// lives in game/upgrade.js. Keep the multiplier here in sync with that module.
export const UPGRADE_STAT_MULT = 1.2;

/** The upgrade level of an item (0 for un-upgraded or non-weapon items). */
export function itemUpgradeLevel(item) {
  return Math.max(0, Math.floor((item && item.upgrade) || 0));
}

/** The stat multiplier from an item's upgrade level: 1.2^level. */
export function itemStatMult(item) {
  return Math.pow(UPGRADE_STAT_MULT, itemUpgradeLevel(item));
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
    const def = STAT_DEFS.find((d) => d.id === k);
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
  return STAT_DEFS.filter((d) => eff[d.id])
    .map((d) => `+${formatStat(d, eff[d.id]).replace('%', '')}${d.fmt === 'pct' ? '%' : ''} ${d.abbr}`)
    .join(', ');
}

/** Lines for `help items`: every modifier, its stat, tiers and names. */
export function modifierHelpLines() {
  const lines = [];
  const abbr = (id) => STAT_DEFS.find((d) => d.id === id).abbr;
  const def = (id) => STAT_DEFS.find((d) => d.id === id);
  const fmtTiers = (id, names) =>
    names.map((nm, i) => `${nm} (+${formatStat(def(id), modifierValue(id, i + 1))})`).join(' / ');

  lines.push('PREFIXES (name goes before the item):');
  for (const id of STAT_IDS) lines.push(`  ${(abbr(id) + ':').padEnd(9)}${fmtTiers(id, PREFIXES[id])}`);
  lines.push('SUFFIXES (name goes after the item):');
  for (const id of STAT_IDS) lines.push(`  ${(abbr(id) + ':').padEnd(9)}${fmtTiers(id, SUFFIXES[id])}`);
  return lines;
}
