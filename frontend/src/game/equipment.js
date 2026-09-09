// Equipment: slots, equip/unequip rules, and aggregate stat bonuses.
//
// Slots: 5 armour (head/chest/hands/legs/feet) + 2 weapon slots. Weapon rules:
//   - a two-handed weapon fills weapon1 and blocks weapon2,
//   - two one-handed weapons fill weapon1 and weapon2,
//   - a one-handed weapon + an off-hand (e.g. shield) fill weapon1 and weapon2.
//
// Unequipped equipment lives in the inventory as entries whose `meta` is the
// item object (meta.slot marks it as equipment). Equipping moves the item from
// inventory into a slot; unequipping moves it back.

import { state, emitChange } from './state.js';
import { addItem, removeItem, listItems } from './inventory.js';
import { compareItems, effectiveItemStats } from './items.js';

export const ARMOUR_SLOTS = ['head', 'chest', 'hands', 'legs', 'feet'];
export const WEAPON_SLOTS = ['weapon1', 'weapon2'];
export const EQUIP_SLOTS = [...ARMOUR_SLOTS, ...WEAPON_SLOTS];

export const SLOT_LABELS = {
  head: 'Head',
  chest: 'Chest',
  hands: 'Hands',
  legs: 'Legs',
  feet: 'Feet',
  weapon1: 'Weapon 1',
  weapon2: 'Weapon 2',
};

export function emptyEquipment() {
  const e = {};
  for (const s of EQUIP_SLOTS) e[s] = null;
  return e;
}

/** True when weapon2 is unavailable because weapon1 holds a two-hander. */
export function isWeapon2Blocked() {
  const w1 = state.equipment.weapon1;
  return !!(w1 && w1.hands === 2);
}

/** Equipment items currently in the inventory (the item objects). */
export function listEquippable() {
  return listItems()
    .filter((e) => e.meta && e.meta.slot)
    .map((e) => e.meta);
}

export function findEquippableByName(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return undefined;
  return listEquippable().find((it) => it.name.toLowerCase().includes(q));
}

/** Whether an item can go into a given slot. */
export function fitsSlot(item, slot) {
  if (slot === 'weapon1') return item.slot === 'weapon' && (item.hands === 1 || item.hands === 2);
  if (slot === 'weapon2') return item.slot === 'weapon' && (item.hands === 1 || item.hands === 'off');
  return item.slot === slot;
}

/** Inventory items that fit `slot`, sorted by rarity then name. */
export function listForSlot(slot) {
  return listEquippable()
    .filter((it) => fitsSlot(it, slot))
    .sort(compareItems);
}

function toInventory(item) {
  addItem({ id: item.uid, name: item.name, qty: 1, meta: item });
}

/** Equip an item (must currently be in the inventory). */
export function equip(item) {
  removeItem(item.uid, 1);
  if (item.slot === 'weapon') equipWeapon(item);
  else placeArmour(item);
  emitChange();
}

/** Equip the inventory item with the given uid. Returns it, or null. */
export function equipByUid(uid) {
  const entry = listItems().find((e) => e.id === uid);
  if (!entry || !entry.meta) return null;
  equip(entry.meta);
  return entry.meta;
}

/** Equip an item into a specific slot (from the slot-detail menu). */
export function equipInSlot(item, slot) {
  removeItem(item.uid, 1);
  const eq = state.equipment;
  if (item.slot !== 'weapon') {
    if (eq[slot]) toInventory(eq[slot]);
    eq[slot] = item;
  } else if (item.hands === 2) {
    // A two-hander always takes weapon1 and blocks weapon2, whatever slot was picked.
    if (eq.weapon1) toInventory(eq.weapon1);
    if (eq.weapon2) toInventory(eq.weapon2);
    eq.weapon1 = item;
    eq.weapon2 = null;
  } else {
    // 1h / off-hand into the chosen weapon slot; clear a blocking two-hander.
    if (eq.weapon1 && eq.weapon1.hands === 2) {
      toInventory(eq.weapon1);
      eq.weapon1 = null;
    }
    if (eq[slot]) toInventory(eq[slot]);
    eq[slot] = item;
  }
  emitChange();
}

export function equipInSlotByUid(uid, slot) {
  const entry = listItems().find((e) => e.id === uid);
  if (!entry || !entry.meta) return null;
  equipInSlot(entry.meta, slot);
  return entry.meta;
}

function placeArmour(item) {
  const cur = state.equipment[item.slot];
  if (cur) toInventory(cur);
  state.equipment[item.slot] = item;
}

function equipWeapon(item) {
  const eq = state.equipment;
  const clear2h = () => {
    if (eq.weapon1 && eq.weapon1.hands === 2) {
      toInventory(eq.weapon1);
      eq.weapon1 = null;
    }
  };

  if (item.hands === 2) {
    if (eq.weapon1) toInventory(eq.weapon1);
    if (eq.weapon2) toInventory(eq.weapon2);
    eq.weapon1 = item;
    eq.weapon2 = null;
  } else if (item.hands === 'off') {
    clear2h();
    if (eq.weapon2) toInventory(eq.weapon2);
    eq.weapon2 = item;
  } else {
    // one-handed weapon
    clear2h();
    if (!eq.weapon1) eq.weapon1 = item;
    else if (!eq.weapon2) eq.weapon2 = item;
    else {
      toInventory(eq.weapon1);
      eq.weapon1 = item;
    }
  }
}

/** Unequip a slot; returns the item (now back in the inventory) or null. */
export function unequip(slot) {
  const it = state.equipment[slot];
  if (!it) return null;
  state.equipment[slot] = null;
  toInventory(it);
  emitChange();
  return it;
}

/** Sum of stat bonuses from every equipped item (post-upgrade): { statId: total }. */
export function equipmentBonuses() {
  const out = {};
  for (const slot of EQUIP_SLOTS) {
    const it = state.equipment[slot];
    if (!it) continue;
    for (const [k, v] of Object.entries(effectiveItemStats(it))) out[k] = (out[k] || 0) + v;
  }
  return out;
}

/**
 * Find an item by uid, whether equipped or in the inventory.
 * @returns {{item:object, where:'equipment'|'inventory', slot?:string}|null}
 */
export function locateItem(uid) {
  for (const slot of EQUIP_SLOTS) {
    const it = state.equipment[slot];
    if (it && it.uid === uid) return { item: it, where: 'equipment', slot };
  }
  const entry = listItems().find((e) => e.meta && e.meta.uid === uid);
  if (entry) return { item: entry.meta, where: 'inventory' };
  return null;
}
