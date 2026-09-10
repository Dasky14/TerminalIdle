// The item CATALOGUE loader — the item CONTENT lives in ONE place:
// public/items.json. Edit that file to add/adjust weapons, armour, name
// modifiers, legendaries, and effects. There is no second copy in code.
//
// public/items.json is imported here at build time (so there's always a valid
// baseline) AND re-fetched at runtime by loadItems(), so post-build edits to
// dist/items.json — and an optional backend /items override — take effect
// without a rebuild. Consumers read the active catalogue via getItems().
//
// EFFECTS: `effects` is a registry (id -> { desc, value? }). ANY item can carry
// an effect by listing its id in its `effects` array (a bare id string, or
// { id, value?, desc? } to override the registry). The effect's combat BEHAVIOUR
// is implemented by id in the dungeon (frontend/public/minigames/dungeon) — so
// reusing an existing effect on a new item is a pure data edit, while a
// brand-new effect id also needs a hook added there. See docs/LOOT_RULES.md.
//
// Balance NUMBERS that aren't item content (drop rates, luck, the modifier tier
// bias, character growth) live in game/balance.js / public/balance.json instead.

import { getConfig } from '../config.js';
// The single source of truth for item content. Imported (build-time) as the
// baseline; re-fetched at runtime for post-build / backend overrides.
import DEFAULT_ITEMS from '../../public/items.json';

let current = clone(DEFAULT_ITEMS);

/** Synchronous access to the active catalogue (baseline until loadItems runs). */
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

/** Sanitize one modifier definition, or return null if unusable. */
function validMod(m) {
  if (!isPlainObject(m)) return null;
  const names = Array.isArray(m.names) ? m.names.filter((s) => typeof s === 'string' && s) : [];
  if (!names.length) return null; // names define the tiers; a modifier needs at least one
  const stats = {};
  if (isPlainObject(m.stats)) {
    for (const [s, v] of Object.entries(m.stats)) if (typeof v === 'number' && Number.isFinite(v)) stats[s] = v;
  }
  const weight = typeof m.weight === 'number' && Number.isFinite(m.weight) && m.weight > 0 ? m.weight : 100;
  return { weight, names, stats };
}

/** Validate a modifier pool (prefixes/suffixes); fall back to default if empty. */
function validMods(over, def) {
  if (!isPlainObject(over)) return clone(def);
  const out = {};
  for (const [id, m] of Object.entries(over)) {
    const v = validMod(m);
    if (v) out[id] = v;
  }
  return Object.keys(out).length ? out : clone(def);
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

/**
 * Rebuild a known-good catalogue from `raw`, keeping valid entries and falling
 * back per-section to the bundled items.json (DEFAULT_ITEMS) when a section is
 * missing or unusable. This is the trust boundary for a hand-edited items.json
 * and any backend /items response.
 */
function validate(raw) {
  const d = DEFAULT_ITEMS;
  const b = isPlainObject(raw) ? raw : {};
  return {
    bases: validBases(b.bases, d.bases),
    prefixes: validMods(b.prefixes, d.prefixes),
    suffixes: validMods(b.suffixes, d.suffixes),
    legendaries: validBases(b.legendaries, d.legendaries),
    effects: validEffects(b.effects, d.effects),
  };
}

/**
 * Resolve the active item catalogue: the bundled items.json, then an optional
 * backend /items override merged on top, then validated. Always resolves (falls
 * back to the build-time items.json). Call once at startup, before anything
 * generates or renders items.
 */
export async function loadItems() {
  let raw = clone(DEFAULT_ITEMS);

  // Runtime copy of items.json (lets a deployed dist/items.json be edited without
  // a rebuild). Same file as the build-time import unless edited post-build.
  try {
    const url = `${import.meta.env.BASE_URL}items.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) raw = deepMerge(raw, await res.json());
    else if (res.status !== 404) throw new Error(`items.json HTTP ${res.status}`);
  } catch (err) {
    console.warn('[items] Using build-time items.json:', err.message);
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
