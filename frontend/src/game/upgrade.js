// Equipment upgrades.
//
// Any piece of gear (weapon OR armour) can be upgraded. Each upgrade multiplies
// the item's stats by UPGRADE_STAT_MULT (see game/items.js) and is shown after
// the name as "+N". The material cost grows exponentially, so there's no hard
// cap but each level costs meaningfully more than the last:
//   materials(L -> L+1) = round(UPGRADE_BASE_COST * UPGRADE_COST_GROWTH^L)
// The material is orientation-matched: physical gear costs SCRAP, magical gear
// costs ESSENCE (see game/salvage.js for where those come from).
//
// Legendary gear additionally consumes DUPLICATES of itself: +1 needs 1
// duplicate, +1->+2 needs 2, +2->+3 needs 3, and so on (level L -> L+1 needs
// L+1). Duplicates are other inventory items with the same base legendary key.
//
// The upgrade economy's numbers — stat multiplier and the cost constants below
// — all live in game/balance.js (`upgrade` section). itemStatMult (items.js)
// reads statMult; upgradeCost() here reads costGrowth / baseCost.

import { emitChange } from './state.js';
import { getResource, addResource } from './resources.js';
import { listItems, removeItem } from './inventory.js';
import { itemUpgradeLevel } from './items.js';
import { getBalance } from './balance.js';

/** Any equipment item (has an equip slot) can be upgraded. */
export function isUpgradeable(item) {
  return !!item && !!item.slot;
}

/** 'physical' (scrap) or 'magical' (essence), from the item's base stats. */
export function itemOrientation(item) {
  const s = (item && item.stats) || {};
  const phys = (s.patt || 0) + (s.pdef || 0);
  const mag = (s.matt || 0) + (s.mdef || 0);
  return mag > phys ? 'magical' : 'physical';
}

export function upgradeResource(item) {
  return itemOrientation(item) === 'magical' ? 'essence' : 'scrap';
}

/** The cost to take an item from its current level to the next. */
export function upgradeCost(item) {
  const lvl = itemUpgradeLevel(item);
  const { baseCost, costGrowth } = getBalance().upgrade;
  return {
    level: lvl + 1,
    resource: upgradeResource(item),
    amount: Math.round(baseCost * Math.pow(costGrowth, lvl)),
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

/** Can this item be upgraded right now? Returns { ok, cost, error? }. */
export function canUpgrade(item) {
  if (!isUpgradeable(item)) return { ok: false, error: 'this item cannot be upgraded' };
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
 * Upgrade a gear item one level, spending materials (and legendary duplicates).
 * Mutates the item in place, so it works whether the item is equipped or in the
 * inventory (both hold the same object reference).
 * @returns {{ok:true, level:number, cost:object} | {ok:false, error:string}}
 */
export function upgradeGear(item) {
  const chk = canUpgrade(item);
  if (!chk.ok) return chk;
  const { cost } = chk;
  if (cost.duplicates) consumeDuplicates(item, cost.duplicates);
  addResource(cost.resource, -cost.amount);
  item.upgrade = itemUpgradeLevel(item) + 1;
  emitChange();
  return { ok: true, level: item.upgrade, cost };
}
