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
import { POINTS_PER_LEVEL } from './leveling.js';
import { emptyEquipment } from './equipment.js';

const STORAGE_KEY = 'til.save.v1';

// --- Migration --------------------------------------------------------------
// Each entry migrates a save FROM version N to N+1. Add new ones as the schema
// evolves; older saves are upgraded step by step on import/load.
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
        : Math.max(0, ((old.profile && old.profile.level) || 1) - 1) * POINTS_PER_LEVEL,
  }),
  // v2 -> v3: introduce equipment slots.
  2: (old) => ({
    ...old,
    version: 3,
    equipment: old.equipment || emptyEquipment(),
  }),
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
