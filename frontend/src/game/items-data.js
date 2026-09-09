// The item CATALOGUE — the data-driven content behind loot generation.
//
// Add weapons, armour, name modifiers, legendaries, and effects by editing this
// (or, without rebuilding, public/items.json — and a backend can override it,
// same three-layer pattern as game/balance.js). Loaded once at startup by
// loadItems(); consumers read via getItems() at call time.
//
// EFFECTS: `effects` is a registry (id -> { desc, value? }). ANY item can carry
// an effect by listing its id in its `effects` array (a bare id string, or
// { id, value?, desc? } to override the registry). The effect's combat BEHAVIOUR
// is implemented by id in the dungeon (frontend/public/minigames/dungeon) — so
// reusing an existing effect on a new item is a pure data edit here, while a
// brand-new effect id also needs a hook added there. See docs/LOOT_RULES.md.
//
// Balance NUMBERS that aren't item content (drop rates, luck) live in
// game/balance.js instead; item stat values live here because they define the
// item.

import { getConfig } from '../config.js';

/** The embedded fallback catalogue (also the schema/reference for items.json). */
export const DEFAULT_ITEMS = {
  // Attacking weapons need `atkType` ('physical'|'magical'); weapons use slot
  // 'weapon' with `hands` 1 / 2 / 'off'. Two-handed base attack is ~2x a 1H's
  // (see docs/LOOT_RULES.md).
  bases: [
    { key: 'sword', name: 'Sword', slot: 'weapon', hands: 1, atkType: 'physical', stats: { patt: 6 } },
    { key: 'dagger', name: 'Dagger', slot: 'weapon', hands: 1, atkType: 'physical', stats: { patt: 4, speed: 2 } },
    { key: 'wand', name: 'Wand', slot: 'weapon', hands: 1, atkType: 'magical', stats: { matt: 6 } },
    { key: 'greatsword', name: 'Greatsword', slot: 'weapon', hands: 2, atkType: 'physical', stats: { patt: 12 } },
    { key: 'staff', name: 'Staff', slot: 'weapon', hands: 2, atkType: 'magical', stats: { matt: 12 } },
    { key: 'shield', name: 'Shield', slot: 'weapon', hands: 'off', stats: { pdef: 5, hp: 20 } },
    { key: 'helmet', name: 'Helmet', slot: 'head', stats: { pdef: 2, mdef: 2 } },
    { key: 'chestplate', name: 'Chestplate', slot: 'chest', stats: { pdef: 4, hp: 30 } },
    { key: 'gauntlets', name: 'Gauntlets', slot: 'hands', stats: { patt: 2, pdef: 1 } },
    { key: 'greaves', name: 'Greaves', slot: 'legs', stats: { pdef: 3 } },
    { key: 'boots', name: 'Boots', slot: 'feet', stats: { speed: 3 } },
  ],
  // Modifier names by stat id; index 0/1/2 = tier 1/2/3. The value each grants is
  // derived in items.js (perPoint x tier), so these are pure naming.
  prefixes: {
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
  },
  suffixes: {
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
  },
  // Named legendaries: fixed stats + effects (by id). Add one and it can drop
  // like any other legendary. Keep at least one entry.
  legendaries: [
    { key: 'excalibur', name: 'Excalibur', slot: 'weapon', hands: 2, atkType: 'physical', stats: { patt: 25, critRate: 10 }, effects: ['ignoreDefense'] },
    { key: 'aegis', name: 'Aegis of the Ancients', slot: 'weapon', hands: 'off', stats: { pdef: 15, mdef: 15, hp: 50 }, effects: ['firstHitShield'] },
    { key: 'sandals', name: "Hermes' Sandals", slot: 'feet', stats: { speed: 15, acc: 5 }, effects: ['alwaysFirst'] },
  ],
  // Effect registry: id -> { desc, value? }. `value` is the parameter the combat
  // hook reads (e.g. fraction of defense ignored). Implemented by id in the dungeon.
  effects: {
    ignoreDefense: { value: 0.3, desc: 'Radiant Edge — ignores 30% of enemy defense.' },
    firstHitShield: { desc: 'Bulwark — negates the first hit each battle.' },
    alwaysFirst: { desc: 'Fleetfooted — you always act first.' },
  },
};

let current = clone(DEFAULT_ITEMS);

/** Synchronous access to the active catalogue (defaults until loadItems runs). */
export function getItems() {
  return current;
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  if (!isPlainObject(over)) return over;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const k of Object.keys(over)) out[k] = deepMerge(out[k], over[k]);
  return out;
}

/** Keep only well-formed item definitions; fall back to `def` if none survive. */
function validBases(arr, def) {
  if (!Array.isArray(arr)) return def.map((b) => clone(b));
  const ok = arr.filter(
    (b) => isPlainObject(b) && typeof b.key === 'string' && typeof b.slot === 'string' && isPlainObject(b.stats),
  );
  return ok.length ? ok.map((b) => clone(b)) : def.map((b) => clone(b));
}

/** Start from the default name tables, overriding a stat's names only with a
 *  full array of >=3 strings — so every stat always has all three tier names. */
function validNames(over, def) {
  const out = clone(def);
  if (isPlainObject(over)) {
    for (const [k, v] of Object.entries(over)) {
      if (Array.isArray(v) && v.length >= 3 && v.every((s) => typeof s === 'string')) out[k] = v.slice(0, 3);
    }
  }
  return out;
}

function validEffects(over, def) {
  if (!isPlainObject(over)) return clone(def);
  const out = {};
  for (const [id, e] of Object.entries(over)) {
    if (!isPlainObject(e)) continue;
    const entry = {};
    entry.desc = typeof e.desc === 'string' && e.desc ? e.desc : id;
    if (typeof e.value === 'number' && Number.isFinite(e.value)) entry.value = e.value;
    out[id] = entry;
  }
  return Object.keys(out).length ? out : clone(def);
}

function validate(raw) {
  const d = DEFAULT_ITEMS;
  const b = isPlainObject(raw) ? raw : {};
  return {
    bases: validBases(b.bases, d.bases),
    prefixes: validNames(b.prefixes, d.prefixes),
    suffixes: validNames(b.suffixes, d.suffixes),
    legendaries: validBases(b.legendaries, d.legendaries),
    effects: validEffects(b.effects, d.effects),
  };
}

/**
 * Resolve the active item catalogue: embedded default -> bundled items.json ->
 * optional backend /items. Always resolves (falls back cleanly). Call once at
 * startup, before anything generates or renders items.
 */
export async function loadItems() {
  let raw = clone(DEFAULT_ITEMS);

  try {
    const url = `${import.meta.env.BASE_URL}items.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) raw = deepMerge(raw, await res.json());
    else if (res.status !== 404) throw new Error(`items.json HTTP ${res.status}`);
  } catch (err) {
    console.warn('[items] Using built-in defaults for items.json:', err.message);
  }

  const { apiBase } = getConfig();
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase.replace(/\/$/, '')}/items`, { cache: 'no-store' });
      if (res.ok) raw = deepMerge(raw, await res.json());
    } catch {
      /* backend optional; keep local catalogue */
    }
  }

  current = validate(raw);
  return current;
}
