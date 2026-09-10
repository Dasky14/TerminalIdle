// Persistence: localStorage load/save + JSON export/import + version migration.
//
// The entire game lives client-side. There are no accounts. This module is the
// only place that touches localStorage or the filesystem (via download/upload).

import {
  state,
  replaceState,
  createInitialState,
  onChange,
  SAVE_VERSION,
} from './state.js';
import { emptyStats } from './stats.js';
import { pointsPerLevel } from './leveling.js';
import { emptyEquipment } from './equipment.js';

const STORAGE_KEY = 'til.save.v1';

// --- Migration --------------------------------------------------------------
// Each entry migrates a save FROM version N to N+1. Add new ones as the schema
// evolves; older saves are upgraded step by step on import/load.

/** Strip a baked item down to its RECIPE (v6+). Keeps identity + modifier refs;
 *  name/stats/effects are computed from the catalogue at read time. Handles both
 *  the modifier shapes used across versions ({id,...} and older {statId,...}). */
function toItemRecipe(it) {
  if (!it || typeof it !== 'object') return it;
  const r = { uid: it.uid, base: it.base, rarity: it.rarity, slot: it.slot, upgrade: it.upgrade || 0 };
  if (it.hands != null) r.hands = it.hands;
  if (it.atkType) r.atkType = it.atkType;
  r.mods = Array.isArray(it.mods)
    ? it.mods
        .map((m) => ({ id: m.id || m.statId, kind: m.kind, tier: m.tier || 1 }))
        .filter((m) => m.id && m.kind)
    : [];
  return r;
}

const MIGRATIONS = {
  // v1 -> v2: introduce character stats. Grant retroactive points for levels
  // already earned so existing players aren't shortchanged.
  1: (old) => ({
    ...old,
    version: 2,
    stats: old.stats || emptyStats(),
    statPoints:
      old.statPoints != null
        ? old.statPoints
        : Math.max(0, ((old.profile && old.profile.level) || 1) - 1) * pointsPerLevel(),
  }),
  // v2 -> v3: introduce equipment slots.
  2: (old) => ({
    ...old,
    version: 3,
    equipment: old.equipment || emptyEquipment(),
  }),
  // v3 -> v4: introduce salvaging (auto-scrap rules) and idle away-time
  // tracking (per-minigame lastOpen metadata). Weapon upgrade levels live on
  // items as `upgrade` and default to 0 with no migration needed.
  3: (old) => ({
    ...old,
    version: 4,
    autoScrap: old.autoScrap || { all: [], byType: {} },
    minigameMeta: old.minigameMeta || {},
  }),
  // v5 -> v6: items become RECIPES (base + modifier refs + rolled tiers +
  // upgrade); their name and stats are computed live from the catalogue instead
  // of baked in, so editing items.json / balance.json retroactively rebalances
  // owned gear. Strip the baked stats/name/effects; keep the recipe.
  5: (old) => {
    const eq = old.equipment || {};
    const equipment = {};
    for (const [slot, it] of Object.entries(eq)) equipment[slot] = it ? toItemRecipe(it) : null;
    const inventory = (old.inventory || []).map((e) =>
      e && e.meta && e.meta.slot ? { ...e, meta: toItemRecipe(e.meta) } : e,
    );
    return { ...old, version: 6, equipment, inventory };
  },
  // v4 -> v5: rename combat stats to characteristics (two-layer model). The
  // allocated POINT counts transfer 1:1 (the new per-point derivation reproduces
  // the same combat values), and Dodge folds into Agility (points summed with
  // Speed). Equipment/items keep their combat-stat keys, so they're untouched.
  4: (old) => {
    const s = old.stats || {};
    const n = (k) => s[k] || 0;
    return {
      ...old,
      version: 5,
      stats: {
        vitality: n('hp'),
        strength: n('patt'),
        intelligence: n('matt'),
        constitution: n('pdef'),
        spirit: n('mdef'),
        agility: n('speed') + n('dodge'),
        perception: n('acc'),
        critRate: n('critRate'),
        critDmg: n('critDmg'),
        luck: n('luck'),
      },
    };
  },
};

/** Run a (possibly old) save object up to the current SAVE_VERSION. */
export function migrate(save) {
  let s = save;
  let v = Number(s.version) || 0;
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) {
      // No migration path — start fresh but keep nothing risky.
      console.warn(`[save] No migration from v${v}; resetting to a new save.`);
      return createInitialState();
    }
    s = step(s);
    v = Number(s.version) || v + 1;
  }
  return s;
}

/** Shallow structural sanity check. Returns true if it looks like our save. */
function looksValid(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.profile === 'object' &&
    typeof obj.resources === 'object' &&
    Array.isArray(obj.inventory)
  );
}

// --- localStorage -----------------------------------------------------------

/** Load from localStorage into state, or initialize a fresh save. */
export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      replaceState(createInitialState());
      return { fresh: true };
    }
    const parsed = JSON.parse(raw);
    if (!looksValid(parsed)) throw new Error('save failed validation');
    replaceState(migrate(parsed));
    return { fresh: false };
  } catch (err) {
    console.warn('[save] Could not load save, starting fresh:', err.message);
    replaceState(createInitialState());
    return { fresh: true, error: err.message };
  }
}

/** Write current state to localStorage immediately. */
export function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.error('[save] Failed to persist:', err);
    return false;
  }
}

/** Wipe the save and reset to a fresh game. */
export function resetSave() {
  localStorage.removeItem(STORAGE_KEY);
  replaceState(createInitialState());
}

/** Auto-persist on every state change, debounced. Returns an unsubscribe fn. */
export function enableAutosave(delayMs = 400) {
  let timer = null;
  return onChange(() => {
    clearTimeout(timer);
    timer = setTimeout(saveToStorage, delayMs);
  });
}

// --- Export / Import (file) -------------------------------------------------

/** Trigger a browser download of the current save as JSON. */
export function exportSave() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `terminal-idle-save-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return a.download;
}

/**
 * Open a file picker and import the chosen save. Resolves with a summary, or
 * rejects with an Error the caller can print.
 * @returns {Promise<{level: number}>}
 */
export function importSave() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return reject(new Error('No file selected.'));
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!looksValid(parsed)) throw new Error('That file is not a valid save.');
        const migrated = migrate(parsed);
        replaceState(migrated);
        saveToStorage();
        resolve({ level: migrated.profile.level });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    document.body.appendChild(input);
    input.click();
  });
}
