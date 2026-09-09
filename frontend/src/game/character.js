// Character stat allocation operations.
//
// The mutation ops live here (separate from the pure config/formulas in
// stats.js) so stats.js has no dependency on game state and stays trivially
// testable/graphable.

import { state, emitChange } from './state.js';
import { findStat, statValue, STAT_DEFS } from './stats.js';
import { equipmentBonuses, EQUIP_SLOTS } from './equipment.js';
import { itemEffects, weaponAtkType } from './items.js';

/**
 * The player's effective combat stats: allocation value + equipment bonuses,
 * per stat id. Used to feed minigames (e.g. the dungeon) the real numbers.
 * @returns {Record<string, number>}
 */
export function effectiveStats() {
  const bonuses = equipmentBonuses();
  const out = {};
  for (const d of STAT_DEFS) {
    out[d.id] = statValue(d, state.stats[d.id] || 0) + (bonuses[d.id] || 0);
  }
  return out;
}

/**
 * The player's weapon combat profile: the attacks made per turn and any
 * defensive multiplier, derived from the equipped weapons. Fed to combat games
 * (the dungeon) so damage type and per-weapon multipliers depend on the WEAPON,
 * not on which attack stat is higher. See docs/LOOT_RULES.md.
 *
 *   - Two-handed weapon  -> one attack at 1.3x, of the weapon's type.
 *   - Two one-handed weapons -> one 0.6x attack EACH, of each weapon's type
 *     (so wand + dagger = one 0.6x magical + one 0.6x physical).
 *   - One-handed weapon (+ optional shield) -> one 1.0x attack of its type.
 *   - Off-hand shield -> 1.2x defense multiplier.
 *   - No weapon -> a single 1.0x physical (unarmed) attack.
 *
 * Each attack's raw power uses the player's aggregate stat for its type
 * (physical -> P.Att, magical -> M.Att) times `mult`.
 * @returns {{attacks:{type:'physical'|'magical',mult:number}[], defenseMult:number, label:string}}
 */
export function combatProfile() {
  const w1 = state.equipment.weapon1;
  const w2 = state.equipment.weapon2;
  let attacks;
  let defenseMult = 1;
  let label;

  if (w1 && w1.hands === 2) {
    attacks = [{ type: weaponAtkType(w1), mult: 1.3 }];
    label = 'two-handed';
  } else {
    const oneH = [];
    if (w1 && w1.hands === 1) oneH.push(w1);
    if (w2 && w2.hands === 1) oneH.push(w2);
    if ((w1 && w1.hands === 'off') || (w2 && w2.hands === 'off')) defenseMult = 1.2;

    if (oneH.length === 2) {
      attacks = oneH.map((w) => ({ type: weaponAtkType(w), mult: 0.6 }));
      label = 'dual wield';
    } else if (oneH.length === 1) {
      attacks = [{ type: weaponAtkType(oneH[0]), mult: 1 }];
      label = defenseMult > 1 ? 'one-handed + shield' : 'one-handed';
    } else {
      attacks = [{ type: 'physical', mult: 1 }];
      label = defenseMult > 1 ? 'unarmed + shield' : 'unarmed';
    }
  }
  return { attacks, defenseMult, label };
}

/**
 * Active special effects from all equipped items, as structured descriptors
 * ({ id, value?, desc }). Fed to minigames so they can implement the effects.
 */
export function activeEffects() {
  const out = [];
  for (const slot of EQUIP_SLOTS) {
    const it = state.equipment[slot];
    for (const e of itemEffects(it)) out.push({ id: e.id, value: e.value, desc: e.desc });
  }
  return out;
}

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
