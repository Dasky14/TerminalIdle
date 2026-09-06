// Character stat definitions and formulas.
//
// DESIGN: the save stores only the number of POINTS allocated to each stat.
// The effective value of a stat is always derived from its points through a
// single pure formula: value = base + perPoint * points. This keeps three
// things easy:
//   - Rebalancing: change `base` / `perPoint` here, nothing else.
//   - Graphing: plot statValue(def, points) over a range of points (or over
//     level, assuming a points-per-level allocation) — see below.
//   - Reallocation / respec: just move the point counts around; values recompute.
//
// If a stat ever needs a non-linear curve, give its def a `curve(points)`
// function and statValue() will use it instead of the linear default.

/** @typedef {{id:string,name:string,abbr:string,aliases:string[],base:number,perPoint:number,fmt:'int'|'pct',help?:string[],curve?:(points:number)=>number}} StatDef */

// HELP COUPLING: each stat's `help` lines are printed verbatim by
// `stats help <stat>` (see shell/shell.js statsHelp). Some help lines restate
// COMBAT EQUATIONS whose real implementation lives in the dungeon minigame
// (frontend/public/minigames/dungeon/index.html) — it's a sandboxed iframe and
// can't import this module, so the numbers are duplicated on purpose. If you
// change a formula or constant on one side, update the other:
//   - P.Def / M.Def mitigation  -> dungeon computeAttack()
//   - Accuracy / Dodge hit%      -> dungeon hitChance() (and MIN_HIT)
//   - Crit Damage multiplier     -> dungeon computeAttack()
//   - Luck -> loot rarity         -> game/items.js rollRarity() (LUCK_K, RARITIES)

/** Ordered stat list. `aliases[0]` is the canonical command key. @type {StatDef[]} */
export const STAT_DEFS = [
  {
    id: 'hp', name: 'Health', abbr: 'HP', aliases: ['hp', 'health'],
    base: 100, perPoint: 10, fmt: 'int',
    help: ['Your health pool. When it hits 0 you are defeated.',
      'In the dungeon, HP carries between rooms and only refills at the start of a floor (or on death).'],
  },
  {
    id: 'patt', name: 'Physical Attack', abbr: 'P.Att', aliases: ['p.att', 'patt', 'patk'],
    base: 10, perPoint: 2, fmt: 'int',
    help: ['Physical attack power. An attack uses whichever is higher, P.Att or M.Att, and hits the matching defense.'],
  },
  {
    id: 'matt', name: 'Magical Attack', abbr: 'M.Att', aliases: ['m.att', 'matt', 'matk'],
    base: 10, perPoint: 2, fmt: 'int',
    help: ['Magical attack power. Used instead of P.Att when it is higher, and hits M.Def.'],
  },
  {
    id: 'pdef', name: 'Physical Defense', abbr: 'P.Def', aliases: ['p.def', 'pdef'],
    base: 5, perPoint: 1, fmt: 'int',
    help: ['Reduces incoming physical damage.',
      'damage taken = raw x (1 - P.Def / (P.Def + 50))'],
  },
  {
    id: 'mdef', name: 'Magical Defense', abbr: 'M.Def', aliases: ['m.def', 'mdef'],
    base: 5, perPoint: 1, fmt: 'int',
    help: ['Reduces incoming magical damage.',
      'damage taken = raw x (1 - M.Def / (M.Def + 50))'],
  },
  {
    id: 'speed', name: 'Speed', abbr: 'Speed', aliases: ['speed', 'spd'],
    base: 10, perPoint: 1, fmt: 'int',
    help: ['Determines who acts first in combat — the higher Speed strikes first.'],
  },
  {
    id: 'acc', name: 'Accuracy', abbr: 'Acc', aliases: ['accuracy', 'acc'],
    base: 90, perPoint: 1, fmt: 'int',
    help: ['Your chance to land a hit, measured against the target\'s Dodge.',
      'hit chance = min(100%, Accuracy / (2 x target Dodge))   (never below 10%)',
      'You reach 100% hit at twice the target\'s Dodge.'],
  },
  {
    id: 'dodge', name: 'Dodge', abbr: 'Dodge', aliases: ['dodge', 'ddg', 'eva', 'evasion'],
    base: 20, perPoint: 0.5, fmt: 'int',
    help: ['Your evasion. An attacker hits you with chance min(100%, their Accuracy / (2 x your Dodge)), never below 10%.',
      'Dodge grows slower than Accuracy, so it is a long-term investment rather than a quick fix — but it can never be fully ignored.'],
  },
  {
    id: 'critRate', name: 'Crit Rate', abbr: 'Crit%', aliases: ['crit.rate', 'critrate', 'cr'],
    base: 5, perPoint: 0.5, fmt: 'pct',
    help: ['Chance for an attack to critically hit.'],
  },
  {
    id: 'critDmg', name: 'Crit Damage', abbr: 'CritDmg', aliases: ['crit.dmg', 'critdmg', 'cd'],
    base: 150, perPoint: 5, fmt: 'pct',
    help: ['Damage multiplier on a critical hit (150% = 1.5x damage).'],
  },
  {
    id: 'luck', name: 'Luck', abbr: 'Luck', aliases: ['luck', 'lck'],
    base: 0, perPoint: 1, fmt: 'int',
    help: ['Improves the rarity of the loot you find.',
      'It has no direct combat effect — its value is not added to any combat number; games use it for drop quality.'],
  },
];

/** A fresh { statId: 0 } allocation map. */
export function emptyStats() {
  const s = {};
  for (const d of STAT_DEFS) s[d.id] = 0;
  return s;
}

/** Resolve user input (id, alias, abbr, or name) to a StatDef, or undefined. */
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

/** Effective value of a stat given its allocated points. */
export function statValue(def, points = 0) {
  const p = Number(points) || 0;
  return typeof def.curve === 'function' ? def.curve(p) : def.base + def.perPoint * p;
}

/** Human-readable value, e.g. "112" or "90.5%". */
export function formatStat(def, value) {
  const v = Math.round(value * 10) / 10;
  return def.fmt === 'pct' ? `${v}%` : String(v);
}
