// Global inventory. Items are stacked by `id`.
//
// Item shape: { id: string, name: string, qty: number, meta?: object }

import { state, emitChange } from './state.js';

/** Return the inventory array (read-only view; don't mutate directly). */
export function listItems() {
  return state.inventory;
}

/** Find an item stack by id, or undefined. */
export function getItem(id) {
  return state.inventory.find((it) => it.id === id);
}

/**
 * Add `qty` of an item. Creates the stack if missing; `name`/`meta` fill in on
 * first creation.
 * @param {{id: string, name?: string, qty?: number, meta?: object}} item
 */
export function addItem({ id, name, qty = 1, meta }) {
  if (!id) throw new Error('addItem: id is required');
  const amount = Math.floor(Number(qty) || 0);
  if (amount === 0) return;
  const existing = getItem(id);
  if (existing) {
    existing.qty += amount;
    if (existing.qty <= 0) removeStack(id);
  } else if (amount > 0) {
    state.inventory.push({ id, name: name || id, qty: amount, ...(meta ? { meta } : {}) });
  }
  emitChange();
}

/** Remove up to `qty` of an item. Returns how many were actually removed. */
export function removeItem(id, qty = 1) {
  const existing = getItem(id);
  if (!existing) return 0;
  const removed = Math.min(existing.qty, Math.max(0, Math.floor(qty)));
  existing.qty -= removed;
  if (existing.qty <= 0) removeStack(id);
  emitChange();
  return removed;
}

function removeStack(id) {
  const idx = state.inventory.findIndex((it) => it.id === id);
  if (idx !== -1) state.inventory.splice(idx, 1);
}
