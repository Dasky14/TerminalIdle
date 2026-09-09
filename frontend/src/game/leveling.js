// Global leveling system.
//
// XP is stored cumulatively on profile.xp; level is derived but also cached on
// profile.level. The curve below is a simple escalating requirement — tune
// `xpForLevel` to taste.

import { state, emitChange } from './state.js';
import { getBalance } from './balance.js';

/** Stat points granted on each level up (balance-tunable). */
export function pointsPerLevel() {
  return getBalance().leveling.pointsPerLevel;
}

/** Total XP required to advance FROM `level` to `level + 1`. */
export function xpForLevel(level) {
  // xpBase * currentLevel^xpExponent  (defaults 100 / 1.1: L1->2 = 100, ...).
  // The constants live in game/balance.js (leveling.xpBase / xpExponent).
  const { xpBase, xpExponent } = getBalance().leveling;
  return Math.floor(xpBase * Math.pow(level, xpExponent));
}

/** XP the player currently has toward their next level. */
export function xpIntoLevel() {
  return state.profile.xp;
}

/** Recompute `profile.level` by consuming banked XP. Returns levels gained. */
function applyLevelUps() {
  let gained = 0;
  while (state.profile.xp >= xpForLevel(state.profile.level)) {
    state.profile.xp -= xpForLevel(state.profile.level);
    state.profile.level += 1;
    gained += 1;
  }
  if (gained) state.statPoints = (state.statPoints || 0) + gained * pointsPerLevel();
  return gained;
}

/**
 * Award XP to the global profile. Handles multi-level-ups.
 * @param {number} amount
 * @returns {{levelsGained: number, level: number}}
 */
export function addXp(amount) {
  const xp = Math.max(0, Math.floor(Number(amount) || 0));
  if (xp <= 0) return { levelsGained: 0, level: state.profile.level };
  state.profile.xp += xp;
  const levelsGained = applyLevelUps();
  emitChange();
  return { levelsGained, level: state.profile.level };
}

/** A snapshot handy for rendering a progress bar. */
export function levelSnapshot() {
  const level = state.profile.level;
  const need = xpForLevel(level);
  const have = state.profile.xp;
  return {
    level,
    xpIntoLevel: have,
    xpForNext: need,
    progress: need > 0 ? Math.min(1, have / need) : 0,
  };
}
