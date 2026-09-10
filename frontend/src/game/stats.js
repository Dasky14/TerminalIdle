// Character characteristics + the combat stats they derive.
//
// TWO LAYERS:
//   1. CHARACTERISTICS (STAT_DEFS) — the allocatable stats a player spends points
//      on (Vitality, Strength, …). The save stores only the POINTS per
//      characteristic; its value = base + perPoint * points. These have
//      minigame-neutral names so they read sensibly outside combat.
//   2. COMBAT STATS (COMBAT_STATS) — the numbers combat games actually use (HP,
//      P.Att, …). Each characteristic DERIVES one or more combat stats via its
//      `derive` map (e.g. Vitality → { hp: 10 } means each point of Vitality is
//      +10 HP). Equipment grants combat stats directly. character.js sums both
//      into the effective combat stats sent to the dungeon.
//
// The rescale keeps every combat value identical to before at base / per point
// (e.g. Vitality base 10 × 10 = 100 HP, +1 Vitality = +10 HP). Agility folds the
// old Speed + Dodge: +1 Agility = +1 Speed and +2 Dodge (so base 10 → Speed 10,
// Dodge 20). Crit Rate / Crit Damage / Luck are unchanged and pass straight
// through (derive 1:1).
//
// If a characteristic ever needs a non-linear curve, give its def a
// `curve(points)` function and statValue() will use it instead of the linear default.
//
// The growth numbers (base value + gain per point) are BALANCE and live in
// public/balance.json (`characteristics`), read here via statGrowth(). So a
// characteristic's value = balance base + balance perPoint * allocated points.

import { getBalance } from './balance.js';

/** @typedef {{id:string,name:string,abbr:string,aliases:string[],fmt:'int'|'pct',derive:Record<string,number>,help?:string[],curve?:(points:number)=>number}} StatDef */

// HELP COUPLING: each characteristic's `help` lines are printed verbatim by
// `stats help <stat>` (see shell/shell.js statsHelp). Some restate COMBAT
// EQUATIONS whose real implementation lives in the dungeon minigame
// (frontend/public/minigames/dungeon/index.html) — a sandboxed iframe that can't
// import this module, so the numbers are duplicated on purpose. Change one side,
// change the other:
//   - P.Def / M.Def mitigation (Constitution/Spirit) -> dungeon computeAttack()
//   - Accuracy / Dodge hit% (Perception/Agility)      -> dungeon hitChance() (MIN_HIT)
//   - Crit rate, multi-crit, Crit Damage              -> dungeon computeAttack()
//   - Luck -> loot rarity -> game/items.js rollRarity(); weights & luckK are
//     balance (game/balance.js `loot`), catalogue is game/items-data.js
//   - P.Att/M.Att attack type & weapon multipliers    -> character.js
//     combatProfile() + dungeon combat; loot side in docs/LOOT_RULES.md
// The characteristic->combat DERIVATION lives in each def's `derive` below and is
// applied in character.js (derivedStats).

/** Ordered characteristic list. `aliases[0]` is the canonical command key. @type {StatDef[]} */
// NOTE: `base` and `perPoint` (the growth numbers) are NOT here — they're
// balance and live in public/balance.json (`characteristics`), read via
// statGrowth(). These defs hold only the structural bits: id, display, aliases,
// number format, the characteristic->combat `derive` map, and help text.
export const STAT_DEFS = [
  {
    id: 'vitality', name: 'Vitality', abbr: 'Vit', aliases: ['vitality', 'vit', 'hp'],
    fmt: 'int', derive: { hp: 10 },
    help: ['Your endurance and life force. Each point adds +10 HP in combat.',
      'In the dungeon, HP carries between rooms and only refills at the start of a floor (or on death).'],
  },
  {
    id: 'strength', name: 'Strength', abbr: 'Str', aliases: ['strength', 'str', 'p.att', 'patt'],
    fmt: 'int', derive: { patt: 2 },
    help: [
      'Physical might. Each point adds +2 Physical Attack (P.Att) in combat.',
      'P.Att is used when your equipped weapon is physical (swords, daggers,',
      'greatswords), checked against the enemy\'s P.Def.',
    ],
  },
  {
    id: 'intelligence', name: 'Intelligence', abbr: 'Int', aliases: ['intelligence', 'int', 'm.att', 'matt'],
    fmt: 'int', derive: { matt: 2 },
    help: [
      'Arcane knowledge. Each point adds +2 Magical Attack (M.Att) in combat.',
      'M.Att is used when your equipped weapon is magical (wands, staves), checked',
      'against the enemy\'s M.Def.',
    ],
  },
  {
    id: 'constitution', name: 'Constitution', abbr: 'Con', aliases: ['constitution', 'con', 'p.def', 'pdef'],
    fmt: 'int', derive: { pdef: 1 },
    help: ['Physical resilience. Each point adds +1 Physical Defense (P.Def).',
      'damage taken = raw x (1 - P.Def / (P.Def + 50))'],
  },
  {
    id: 'spirit', name: 'Spirit', abbr: 'Spr', aliases: ['spirit', 'spr', 'm.def', 'mdef'],
    fmt: 'int', derive: { mdef: 1 },
    help: ['Magical resilience. Each point adds +1 Magical Defense (M.Def).',
      'damage taken = raw x (1 - M.Def / (M.Def + 50))'],
  },
  {
    id: 'agility', name: 'Agility', abbr: 'Agi', aliases: ['agility', 'agi', 'speed', 'spd', 'dodge', 'ddg'],
    fmt: 'int', derive: { speed: 1, dodge: 2 },
    help: [
      'Quickness and reflexes. Each point adds +1 Speed and +2 Dodge in combat.',
      'Speed decides who strikes first (higher goes first).',
      'Dodge is your evasion: an attacker hits you with chance',
      'min(100%, their Accuracy / (2 x your Dodge)), never below 10%.',
    ],
  },
  {
    id: 'perception', name: 'Perception', abbr: 'Per', aliases: ['perception', 'per', 'perc', 'accuracy', 'acc'],
    fmt: 'int', derive: { acc: 1 },
    help: ['Awareness and aim. Each point adds +1 Accuracy in combat.',
      'hit chance = min(100%, Accuracy / (2 x target Dodge))   (never below 10%)',
      'You reach 100% hit at twice the target\'s Dodge.'],
  },
  {
    id: 'critRate', name: 'Crit Rate', abbr: 'Crit%', aliases: ['crit.rate', 'critrate', 'cr'],
    fmt: 'pct', derive: { critRate: 1 },
    help: [
      'Chance to land a critical hit.',
      'Above 100% it always crits and rolls the remainder for an extra crit — e.g. 120% = one guaranteed crit + a 20% chance of a second (multi-crit).',
    ],
  },
  {
    id: 'critDmg', name: 'Crit Damage', abbr: 'CritDmg', aliases: ['crit.dmg', 'critdmg', 'cd'],
    fmt: 'pct', derive: { critDmg: 1 },
    help: [
      'Damage multiplier per critical hit (150% = 1.5x).',
      'Multiple crits stack multiplicatively: two crits = raw x 1.5 x 1.5.',
    ],
  },
  {
    id: 'luck', name: 'Luck', abbr: 'Luck', aliases: ['luck', 'lck'],
    fmt: 'int', derive: { luck: 1 },
    help: ['Improves the rarity of the loot you find.',
      'It has no direct combat effect — games use it for drop quality.'],
  },
];

/**
 * The combat stats games use, for LABELS/FORMATTING (HP, P.Att, …). These are
 * derived from characteristics (see each characteristic's `derive`) and are also
 * the units equipment grants. Items reference these ids.
 */
export const COMBAT_STATS = [
  { id: 'hp', name: 'Health', abbr: 'HP', fmt: 'int' },
  { id: 'patt', name: 'Physical Attack', abbr: 'P.Att', fmt: 'int' },
  { id: 'matt', name: 'Magical Attack', abbr: 'M.Att', fmt: 'int' },
  { id: 'pdef', name: 'Physical Defense', abbr: 'P.Def', fmt: 'int' },
  { id: 'mdef', name: 'Magical Defense', abbr: 'M.Def', fmt: 'int' },
  { id: 'speed', name: 'Speed', abbr: 'Speed', fmt: 'int' },
  { id: 'dodge', name: 'Dodge', abbr: 'Dodge', fmt: 'int' },
  { id: 'acc', name: 'Accuracy', abbr: 'Acc', fmt: 'int' },
  { id: 'critRate', name: 'Crit Rate', abbr: 'Crit%', fmt: 'pct' },
  { id: 'critDmg', name: 'Crit Damage', abbr: 'CritDmg', fmt: 'pct' },
  { id: 'luck', name: 'Luck', abbr: 'Luck', fmt: 'int' },
];

const COMBAT_BY_ID = Object.fromEntries(COMBAT_STATS.map((d) => [d.id, d]));

/** Look up a combat-stat def by id (for formatting item/combat values). */
export function combatStat(id) {
  return COMBAT_BY_ID[id];
}

/** A fresh { characteristicId: 0 } allocation map. */
export function emptyStats() {
  const s = {};
  for (const d of STAT_DEFS) s[d.id] = 0;
  return s;
}

/** Resolve user input (id, alias, abbr, or name) to a characteristic def, or undefined. */
export function findStat(input) {
  const q = String(input || '').toLowerCase().trim();
  if (!q) return undefined;
  return STAT_DEFS.find(
    (d) =>
      d.id.toLowerCase() === q ||
      d.abbr.toLowerCase() === q ||
      d.name.toLowerCase() === q ||
      d.aliases.includes(q),
  );
}

/** A characteristic's growth (base value + gain per point), from balance. */
export function statGrowth(def) {
  const c = getBalance().characteristics[def.id];
  return { base: c ? c.base : 0, perPoint: c ? c.perPoint : 1 };
}

/** Effective value of a characteristic given its allocated points. */
export function statValue(def, points = 0) {
  const p = Number(points) || 0;
  if (typeof def.curve === 'function') return def.curve(p);
  const g = statGrowth(def);
  return g.base + g.perPoint * p;
}

/** Human-readable value, e.g. "112" or "90.5%". Works for characteristic or combat defs. */
export function formatStat(def, value) {
  const v = Math.round(value * 10) / 10;
  return def.fmt === 'pct' ? `${v}%` : String(v);
}
