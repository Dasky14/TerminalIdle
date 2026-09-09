// Gear salvaging + auto-scrap.
//
// Salvaging turns an equipment item into two resources:
//   - scrap    — from PHYSICAL stats (P.Att / P.Def)
//   - essence  — from MAGICAL stats  (M.Att / M.Def)
// Neutral stats (HP, Speed, Acc, Dodge, crit, Luck) split evenly between them.
// So a physical weapon yields mostly scrap, a magical one mostly essence, and a
// balanced/utility item a mix. The base yield scales with rarity, plus a small
// bonus for the item's total stat weight. Upgraded weapons salvage for more
// because we read their post-upgrade stats.
//
// Auto-scrap salvages qualifying drops the moment they're obtained (see
// game/rewards.js). Rules are per item TYPE (equip slot; weapons share one
// "weapon" type) with an "all" fallback: a drop is scrapped if its rarity is in
// its type's rule, or — if that type has no rule — in the "all" rule.

import { state, emitChange } from './state.js';
import { addResources } from './resources.js';
import { listItems, removeItem } from './inventory.js';
import { effectiveItemStats, itemUpgradeLevel } from './items.js';
import { STAT_DEFS } from './stats.js';

/** Base salvage output (in resource units) per rarity, before orientation split. */
export const RARITY_SALVAGE = { common: 2, rare: 6, epic: 15, legendary: 40 };

const PHYS_STATS = ['patt', 'pdef'];
const MAG_STATS = ['matt', 'mdef'];

/** The scrap/essence an item would yield if salvaged. */
export function salvageYield(item) {
  const eff = effectiveItemStats(item);
  let phys = 0;
  let mag = 0;
  let neutral = 0;
  for (const d of STAT_DEFS) {
    const v = eff[d.id] || 0;
    if (!v) continue;
    if (PHYS_STATS.includes(d.id)) phys += v;
    else if (MAG_STATS.includes(d.id)) mag += v;
    else neutral += v;
  }
  const total = phys + mag + neutral;
  const denom = total || 1;
  const scrapShare = (phys + neutral / 2) / denom;
  const essenceShare = (mag + neutral / 2) / denom;
  const units = (RARITY_SALVAGE[item.rarity] || 1) + Math.floor(total / 10);
  return {
    scrap: Math.max(0, Math.round(units * scrapShare)),
    essence: Math.max(0, Math.round(units * essenceShare)),
  };
}

/** Salvage one inventory item (by uid). Returns { item, yield } or null. */
export function salvageItem(uid) {
  const entry = listItems().find((e) => e.meta && e.meta.uid === uid);
  if (!entry) return null;
  const item = entry.meta;
  const y = salvageYield(item);
  removeItem(entry.id, 1);
  addResources(y);
  return { item, yield: y };
}

/**
 * Bulk-salvage inventory equipment of a rarity ('all' = every gear). Equipped
 * items are never touched (they live in state.equipment, not the inventory), and
 * bulk-salvage also SKIPS anything that has been upgraded (+1 or higher) so a
 * careless "salvage all" can't destroy invested gear — upgraded items can still
 * be salvaged one at a time from their detail screen.
 * @returns {{count:number, scrap:number, essence:number, skipped:number}}
 */
export function salvageAll(rarity) {
  const all = listItems().filter(
    (e) => e.meta && e.meta.slot && (rarity === 'all' || e.meta.rarity === rarity),
  );
  const items = all.filter((e) => itemUpgradeLevel(e.meta) === 0).map((e) => e.meta);
  const skipped = all.length - items.length;
  let count = 0;
  let scrap = 0;
  let essence = 0;
  for (const it of items) {
    const r = salvageItem(it.uid);
    if (r) {
      count += 1;
      scrap += r.yield.scrap;
      essence += r.yield.essence;
    }
  }
  return { count, scrap, essence, skipped };
}

// --- Auto-scrap configuration ----------------------------------------------

/** The types an auto-scrap rule can target ('all' is the fallback). */
export const AUTO_TYPES = ['all', 'head', 'chest', 'hands', 'legs', 'feet', 'weapon'];
export const AUTO_RARITIES = ['common', 'rare', 'epic', 'legendary'];

/** Ensure the config object exists and is well-formed; returns it. */
function cfg() {
  if (!state.autoScrap || typeof state.autoScrap !== 'object') state.autoScrap = { all: [], byType: {} };
  if (!Array.isArray(state.autoScrap.all)) state.autoScrap.all = [];
  if (!state.autoScrap.byType || typeof state.autoScrap.byType !== 'object') state.autoScrap.byType = {};
  return state.autoScrap;
}

export function getAutoScrap() {
  return cfg();
}

/** The auto-scrap "type" of an item: its slot, with all weapons sharing 'weapon'. */
export function itemType(item) {
  return item.slot === 'weapon' ? 'weapon' : item.slot;
}

/** True when a freshly-obtained item should be auto-salvaged. */
export function shouldAutoScrap(item) {
  const c = cfg();
  const t = itemType(item);
  const rule = c.byType[t] || c.all;
  return rule.includes(item.rarity);
}

/** Set (or clear, with an empty list) the rule for a type. */
export function setAutoScrap(type, rarities) {
  const c = cfg();
  const clean = (rarities || []).filter((r) => AUTO_RARITIES.includes(r));
  if (type === 'all') {
    c.all = clean;
  } else if (clean.length) {
    c.byType[type] = clean;
  } else {
    delete c.byType[type];
  }
  emitChange();
}

/** Flip a single rarity on/off for a type. */
export function toggleAutoScrap(type, rarity) {
  const c = cfg();
  const cur = type === 'all' ? c.all.slice() : (c.byType[type] || []).slice();
  const i = cur.indexOf(rarity);
  if (i === -1) cur.push(rarity);
  else cur.splice(i, 1);
  setAutoScrap(type, cur);
}
