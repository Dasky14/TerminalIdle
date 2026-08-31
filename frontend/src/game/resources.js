// Global named resource counters (e.g. scrap, credits, energy).
//
// Stored as a flat map on state.resources: { [name]: number }.

import { state, emitChange } from './state.js';

/** Current amount of a resource (0 if unseen). */
export function getResource(name) {
  return state.resources[name] || 0;
}

/** Return a shallow copy of all resources for rendering. */
export function listResources() {
  return { ...state.resources };
}

/**
 * Add (or subtract, with a negative amount) a resource. Clamped at 0.
 * @returns {number} the new amount
 */
export function addResource(name, amount) {
  if (!name) throw new Error('addResource: name is required');
  const delta = Math.floor(Number(amount) || 0);
  const next = Math.max(0, getResource(name) + delta);
  state.resources[name] = next;
  emitChange();
  return next;
}

/** Apply a batch of resource deltas: { scrap: 2, credits: 10 }. */
export function addResources(map) {
  if (!map) return;
  for (const [name, amount] of Object.entries(map)) {
    const delta = Math.floor(Number(amount) || 0);
    if (delta !== 0) {
      state.resources[name] = Math.max(0, getResource(name) + delta);
    }
  }
  emitChange();
}
