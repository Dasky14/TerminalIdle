// Global game state: the single source of truth for the whole shell.
//
// Everything that mutates state should go through the small helper modules
// (leveling.js, inventory.js, resources.js, rewards.js) and then call
// `emitChange()` so the UI can re-render. Read freely via `state`.

import { emptyStats } from './stats.js';

export const SAVE_VERSION = 3;

/** Build a brand-new save/state object. */
export function createInitialState() {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    profile: {
      level: 1,
      xp: 0,
    },
    // Allocated stat points per stat id (effective values derived in stats.js).
    stats: emptyStats(),
    // Unspent stat points (5 granted per level up).
    statPoints: 0,
    // Equipped items per slot (see game/equipment.js). null = empty.
    equipment: {
      head: null,
      chest: null,
      hands: null,
      legs: null,
      feet: null,
      weapon1: null,
      weapon2: null,
    },
    // Inventory items: { id, name, qty, meta? }
    inventory: [],
    // Named resource counters: { scrap: 0, credits: 0, ... }
    resources: {},
    // Per-minigame persisted slices, keyed by minigame id.
    minigames: {},
    meta: {
      createdAt: now,
      updatedAt: now,
    },
  };
}

// The live state object. Replaced wholesale on load/import via `replaceState`.
export let state = createInitialState();

// --- Tiny pub/sub -----------------------------------------------------------
const listeners = new Set();

/**
 * Subscribe to state changes. Returns an unsubscribe function.
 * @param {(state: object) => void} fn
 */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Notify all subscribers that state changed. Also bumps updatedAt. */
export function emitChange() {
  state.meta.updatedAt = Date.now();
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (err) {
      console.error('[state] listener error:', err);
    }
  }
}

/**
 * Replace the entire state object (used by load/import). Mutates the exported
 * binding in place-ish by reassigning, then notifies listeners.
 * @param {object} next
 */
export function replaceState(next) {
  state = next;
  emitChange();
}
