// Character stat allocation operations.
//
// The mutation ops live here (separate from the pure config/formulas in
// stats.js) so stats.js has no dependency on game state and stays trivially
// testable/graphable.

import { state, emitChange } from './state.js';
import { findStat, statValue } from './stats.js';

/**
 * Spend (or, with a negative amount, refund) points on a stat.
 * @returns {{ok:true, def, added:number, value:number, points:number}
 *          | {ok:false, error:string}}
 */
export function allocate(statInput, amountInput) {
  const def = findStat(statInput);
  if (!def) return { ok: false, error: `unknown stat: ${statInput}` };

  const n = Math.trunc(Number(amountInput));
  if (!Number.isFinite(n) || n === 0) {
    return { ok: false, error: 'amount must be a non-zero whole number' };
  }
  const available = state.statPoints || 0;
  const current = state.stats[def.id] || 0;

  if (n > 0 && available < n) {
    return { ok: false, error: `not enough points (have ${available})` };
  }
  if (n < 0 && current < -n) {
    return { ok: false, error: `only ${current} points on ${def.abbr}` };
  }

  state.stats[def.id] = current + n;
  state.statPoints = available - n;
  emitChange();
  return { ok: true, def, added: n, value: statValue(def, state.stats[def.id]), points: state.statPoints };
}

/** Refund all allocated points back to the pool (respec). */
export function resetStats() {
  let refunded = 0;
  for (const id of Object.keys(state.stats)) {
    refunded += state.stats[id] || 0;
    state.stats[id] = 0;
  }
  state.statPoints = (state.statPoints || 0) + refunded;
  emitChange();
  return { refunded, points: state.statPoints };
}
