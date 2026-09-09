// Weapon upgrades.
//
// Only weapons can be upgraded. Each upgrade multiplies the weapon's stats by
// UPGRADE_STAT_MULT (see game/items.js) and is shown after the name as "+N".
// The material cost grows exponentially, so there's no hard cap but each level
// costs meaningfully more than the last:
//   materials(L -> L+1) = round(UPGRADE_BASE_COST * UPGRADE_COST_GROWTH^L)
// The material is orientation-matched: physical weapons cost SCRAP, magical
// weapons cost ESSENCE (see game/salvage.js for where those come from).
//
// Legendary weapons additionally consume DUPLICATES of themselves: +1 needs 1
// duplicate, +1->+2 needs 2, +2->+3 needs 3, and so on (level L -> L+1 needs
// L+1). Duplicates are other inventory items with the same base legendary key.
//
// HELP COUPLING: UPGRADE_STAT_MULT lives in game/items.js (it also drives
// effectiveItemStats). The cost constants below are the economy's other half —
// they're documented in `help upgrade` (shell). Change one side, change the doc.

import { emitChange } from './state.js';
import { getResource, addResource } from './resources.js';
import { listItems, removeItem } from './inventory.js';
import { itemUpgradeLevel } from './items.js';

export const UPGRADE_COST_GROWTH = 1.5; // material cost multiplier per level
export const UPGRADE_BASE_COST = 10; // material cost of the first upgrade (0 -> 1)

export function isWeapon(item) {
  return !!item && item.slot === 'weapon';
}

/** 'physical' (scrap) or 'magical' (essence), from the weapon's base stats. */
export function weaponOrientation(item) {
  const s = (item && item.stats) || {};
  const phys = (s.patt || 0) + (s.pdef || 0);
  const mag = (s.matt || 0) + (s.mdef || 0);
  return mag > phys ? 'magical' : 'physical';
}

export function upgradeResource(item) {
  return weaponOrientation(item) === 'magical' ? 'essence' : 'scrap';
}

/** The cost to take an item from its current level to the next. */
export function upgradeCost(item) {
  const lvl = itemUpgradeLevel(item);
  return {
    level: lvl + 1,
    resource: upgradeResource(item),
    amount: Math.round(UPGRADE_BASE_COST * Math.pow(UPGRADE_COST_GROWTH, lvl)),
    duplicates: item.rarity === 'legendary' ? lvl + 1 : 0,
    dupKey: item.base,
  };
}

/** Inventory legendary duplicates of `item` (excludes the item itself). */
export function countDuplicates(item) {
  return listItems()
    .filter(
      (e) =>
        e.meta &&
        e.meta.uid !== item.uid &&
        e.meta.base === item.base &&
        e.meta.rarity === 'legendary',
    )
    .reduce((n, e) => n + e.qty, 0);
}

/** Can this weapon be upgraded right now? Returns { ok, cost, error? }. */
export function canUpgrade(item) {
  if (!isWeapon(item)) return { ok: false, error: 'only weapons can be upgraded' };
  const cost = upgradeCost(item);
  const have = getResource(cost.resource);
  if (have < cost.amount) {
    return { ok: false, cost, error: `need ${cost.amount} ${cost.resource} (have ${have})` };
  }
  if (cost.duplicates) {
    const dups = countDuplicates(item);
    if (dups < cost.duplicates) {
      return {
        ok: false,
        cost,
        error: `need ${cost.duplicates} duplicate ${item.name} (have ${dups})`,
      };
    }
  }
  return { ok: true, cost };
}

function consumeDuplicates(item, n) {
  let need = n;
  const dups = listItems().filter(
    (e) =>
      e.meta && e.meta.uid !== item.uid && e.meta.base === item.base && e.meta.rarity === 'legendary',
  );
  for (const e of dups) {
    if (need <= 0) break;
    const take = Math.min(need, e.qty);
    removeItem(e.id, take);
    need -= take;
  }
}

/**
 * Upgrade a weapon one level, spending materials (and legendary duplicates).
 * Mutates the item in place, so it works whether the item is equipped or in the
 * inventory (both hold the same object reference).
 * @returns {{ok:true, level:number, cost:object} | {ok:false, error:string}}
 */
export function upgradeWeapon(item) {
  const chk = canUpgrade(item);
  if (!chk.ok) return chk;
  const { cost } = chk;
  if (cost.duplicates) consumeDuplicates(item, cost.duplicates);
  addResource(cost.resource, -cost.amount);
  item.upgrade = itemUpgradeLevel(item) + 1;
  emitChange();
  return { ok: true, level: item.upgrade, cost };
}
