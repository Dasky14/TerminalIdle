// Menu screen definitions.
//
// Each screen is built on demand (so it can reflect live game state) via
// buildScreen(id, shell). A screen looks like:
//   {
//     title: 'MAIN MENU',
//     body:  ['optional', 'info lines'],   // plain text, rendered above items
//     items: [{ key: 'S', label: 'Stats', action: (shell) => {...} }]
//   }
//
// `action` receives the shell so it can navigate, open windows, export, etc.
// Navigation items typically call shell.navigate('<id>'); a "Back" item calls
// shell.back().

import { levelSnapshot } from '../game/leveling.js';
import { listItems } from '../game/inventory.js';
import { listResources } from '../game/resources.js';
import { MINIGAMES } from '../minigames/registry.js';
import { getConfig } from '../config.js';
import { state } from '../game/state.js';
import { STAT_DEFS, statValue, formatStat } from '../game/stats.js';
import {
  EQUIP_SLOTS,
  SLOT_LABELS,
  listForSlot,
  isWeapon2Blocked,
  equipmentBonuses,
  locateItem,
} from '../game/equipment.js';
import { describeStats, compareItems, itemEffects, itemDisplayName } from '../game/items.js';
import { salvageYield, getAutoScrap, AUTO_TYPES, AUTO_RARITIES } from '../game/salvage.js';
import { isWeapon, upgradeCost, canUpgrade, weaponOrientation, countDuplicates } from '../game/upgrade.js';

const BACK = { key: 'B', label: 'Back', action: (shell) => shell.back() };

const PAGE_SIZE = 15;

// Human labels for auto-scrap "types" (equip slots + the 'all' fallback).
const TYPE_LABELS = {
  all: 'All types', head: 'Head', chest: 'Chest', hands: 'Hands',
  legs: 'Legs', feet: 'Feet', weapon: 'Weapons',
};
const handsLabel = (h) => (h === 2 ? 'two-handed' : h === 'off' ? 'off-hand' : 'one-handed');

/** Slice an array to the shell's current page, clamping the page in range. */
function paginate(shell, arr) {
  const pages = Math.max(1, Math.ceil(arr.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, shell.listPage || 0), pages - 1);
  shell.listPage = page; // clamp back (e.g. after the list shrank)
  return { slice: arr.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), page, pages, total: arr.length };
}

/** Next/Prev page menu items for a paginated list. */
function pageItems(page, pages) {
  const items = [];
  if (page < pages - 1) {
    items.push({ label: 'Next page', hint: `to page ${page + 2} of ${pages}`, action: (s) => s.nextPage() });
  }
  if (page > 0) {
    items.push({ label: 'Prev page', hint: `to page ${page} of ${pages}`, action: (s) => s.prevPage() });
  }
  return items;
}

export function buildScreen(id, shell) {
  switch (id) {
    case 'root':
      return {
        title: 'MAIN MENU',
        body: [],
        items: [
          { key: 'S', label: 'Stats', action: (s) => s.navigate('stats') },
          { key: 'E', label: 'Equipment', action: (s) => s.navigate('equipment') },
          { key: 'I', label: 'Inventory', action: (s) => s.navigate('inventory') },
          { key: 'R', label: 'Resources', action: (s) => s.navigate('resources') },
          { key: 'G', label: 'Games', action: (s) => s.navigate('games') },
          { key: 'Y', label: 'System', action: (s) => s.navigate('system') },
        ],
      };

    case 'stats': {
      const snap = levelSnapshot();
      const bar = progressBar(snap.progress, 20);
      // Base = starting value + allocated points. Total = base + equipment.
      const bonuses = equipmentBonuses();
      const body = [
        `Level    : ${snap.level}`,
        `XP       : ${snap.xpIntoLevel} / ${snap.xpForNext}`,
        `Progress : ${bar} ${(snap.progress * 100).toFixed(0)}%`,
        `Points   : ${state.statPoints} unspent`,
        '',
        `${''.padEnd(9)}${'Base'.padStart(7)}${'Total'.padStart(9)}`,
        ...STAT_DEFS.map((d) => {
          const pts = state.stats[d.id] || 0;
          const base = statValue(d, pts);
          const total = base + (bonuses[d.id] || 0);
          return (
            `${(d.abbr + ':').padEnd(9)}` +
            `${formatStat(d, base).padStart(7)}` +
            `${formatStat(d, total).padStart(9)}` +
            `   (${pts} pts)`
          );
        }),
      ];
      return {
        title: 'STATS',
        body,
        items: [
          { label: 'Allocate stats', hint: 'spend your points', action: (s) => s.navigate('stats-allocate') },
          { label: 'Stats help', hint: 'growth per point', action: (s) => s.statsHelp() },
          BACK,
        ],
      };
    }

    case 'stats-allocate': {
      const items = STAT_DEFS.map((d) => ({
        label: d.abbr,
        hint: `+${d.perPoint}/pt · type "${d.aliases[0]}"`,
        action: (s) => s.prefillAllocate(d.aliases[0]),
      }));
      items.push({ label: 'Reset (respec)', hint: 'refund all points', action: (s) => s.statsReset() });
      items.push(BACK);
      return {
        title: 'ALLOCATE STATS',
        body: [
          `Points available: ${state.statPoints}`,
          'pick a stat to prefill "stats add <stat>", then type the amount.',
        ],
        items,
      };
    }

    case 'inventory':
      return {
        title: 'INVENTORY',
        body: ['choose a category:'],
        items: [
          { label: 'Equipment', hint: 'weapons & armour', action: (s) => s.openInvCat('equipment') },
          { label: 'Other', hint: 'materials & misc', action: (s) => s.openInvCat('other') },
          { label: 'Salvage', hint: 'break gear into scrap & essence', action: (s) => s.navigate('salvage') },
          { label: 'Auto-scrap', hint: 'auto-salvage drops by rarity', action: (s) => s.navigate('autoscrap') },
          BACK,
        ],
      };

    case 'inventory-cat': {
      const cat = shell.invCat || 'other';
      if (cat === 'equipment') {
        const gear = listItems()
          .filter((e) => e.meta && e.meta.slot)
          .map((e) => e.meta)
          .sort(compareItems);
        const { slice, page, pages, total } = paginate(shell, gear);
        const body = total ? [`Page ${page + 1}/${pages}  (${total} items) — select one for details`] : ['(no equipment yet)'];
        const items = slice.map((it) => ({
          label: `[${it.rarity}] ${itemDisplayName(it)}`,
          hint: describeStats(it),
          action: (s) => s.openItem(it.uid),
        }));
        items.push(...pageItems(page, pages), BACK);
        return { title: 'INVENTORY / EQUIPMENT', body, items };
      }
      const others = listItems().filter((e) => !(e.meta && e.meta.slot));
      const { slice, page, pages, total } = paginate(shell, others);
      const body = total
        ? slice.map((e) => `${String(e.qty).padStart(4)}x  ${e.name}`)
        : ['(nothing here yet)'];
      if (total) body.push('', `Page ${page + 1}/${pages}  (${total} items)`);
      return { title: 'INVENTORY / OTHER', body, items: [...pageItems(page, pages), BACK] };
    }

    case 'equipment': {
      const eq = state.equipment;
      const bonuses = equipmentBonuses();
      const bonusStr = STAT_DEFS.filter((d) => bonuses[d.id])
        .map((d) => `+${formatStat(d, bonuses[d.id])} ${d.abbr}`)
        .join(', ');
      const body = [bonusStr ? `Total bonuses: ${bonusStr}` : 'select a slot to view or change its gear'];

      const items = EQUIP_SLOTS.map((slot) => {
        let val;
        if (slot === 'weapon2' && isWeapon2Blocked()) val = '-- (2-handed)';
        else val = eq[slot] ? itemDisplayName(eq[slot]) : '(empty)';
        return { label: `${SLOT_LABELS[slot]}: ${val}`, action: (s) => s.openSlot(slot) };
      });
      items.push(BACK);
      return { title: 'EQUIPMENT', body, items };
    }

    case 'equip-slot': {
      const slot = shell.equipSlot || EQUIP_SLOTS[0];
      const eq = state.equipment;
      const equipped = eq[slot];
      const body = [];
      if (equipped) {
        const desc = describeStats(equipped);
        body.push(`Equipped: [${equipped.rarity}] ${itemDisplayName(equipped)}${desc ? '  (' + desc + ')' : ''}`);
        for (const e of itemEffects(equipped)) body.push(`Effect: ${e.desc}`);
      } else {
        body.push('Equipped: (none)');
      }
      if (slot === 'weapon2' && isWeapon2Blocked()) {
        body.push('Weapon 1 holds a two-handed weapon.');
      }

      const list = listForSlot(slot);
      const { slice, page, pages, total } = paginate(shell, list);
      const items = [];
      if (equipped) {
        items.push({ label: 'Item details', hint: 'info / upgrade', action: (s) => s.openItem(equipped.uid) });
        items.push({ label: 'Unequip', hint: itemDisplayName(equipped), action: (s) => s.unequipSlot(slot) });
      }
      for (const it of slice) {
        const desc = describeStats(it);
        const fx = itemEffects(it).map((e) => e.desc).join('; ');
        const hint = `${it.rarity}${desc ? ' · ' + desc : ''}${fx ? ' · ' + fx : ''}`;
        items.push({ label: itemDisplayName(it), hint, action: (s) => s.equipIntoSlot(it.uid) });
      }
      items.push(...pageItems(page, pages), BACK);
      if (!total) body.push('', '(no items in your inventory fit this slot)');
      else body.push('', `Page ${page + 1}/${pages}  (${total} items)`);
      return { title: SLOT_LABELS[slot] || 'SLOT', body, items };
    }

    case 'resources': {
      const res = listResources();
      const keys = Object.keys(res);
      const body = keys.length
        ? keys.map((k) => `${k.padEnd(12)} ${res[k]}`)
        : ['(no resources yet)'];
      return { title: 'RESOURCES', body, items: [BACK] };
    }

    case 'item-detail': {
      const loc = locateItem(shell.itemUid);
      if (!loc) return { title: 'ITEM', body: ['(item no longer exists)'], items: [BACK] };
      const it = loc.item;
      const desc = describeStats(it);
      const body = [
        `[${it.rarity}] ${itemDisplayName(it)}`,
        `Slot: ${SLOT_LABELS[it.slot] || TYPE_LABELS[it.slot] || it.slot}` +
          (it.slot === 'weapon' ? ` · ${handsLabel(it.hands)}` : ''),
        desc ? `Stats: ${desc}` : 'Stats: (none)',
      ];
      for (const e of itemEffects(it)) body.push(`Effect: ${e.desc}`);
      const y = salvageYield(it);
      body.push(loc.where === 'equipment' ? `Equipped in ${SLOT_LABELS[loc.slot]}` : 'In your inventory');
      if (isWeapon(it)) body.push(`Orientation: ${weaponOrientation(it)}  (upgrades cost ${upgradeCost(it).resource})`);
      body.push(`Salvage value: +${y.scrap} scrap, +${y.essence} essence`);

      const items = [];
      if (loc.where === 'inventory') items.push({ label: 'Equip', action: (s) => s.equipDetail(shell.itemUid) });
      else items.push({ label: 'Unequip', action: (s) => s.unequipSlot(loc.slot) });

      if (isWeapon(it)) {
        const cost = upgradeCost(it);
        const chk = canUpgrade(it);
        const dupStr = cost.duplicates ? ` + ${cost.duplicates} dup (have ${countDuplicates(it)})` : '';
        items.push({
          label: `Upgrade to +${cost.level}`,
          hint: `${cost.amount} ${cost.resource}${dupStr}${chk.ok ? '' : ' · ' + chk.error}`,
          action: (s) => s.upgradeItem(shell.itemUid),
        });
      }
      if (loc.where === 'inventory') {
        items.push({ label: 'Salvage', hint: `+${y.scrap} scrap / +${y.essence} essence`, action: (s) => s.salvageOne(shell.itemUid) });
      } else {
        body.push('(unequip an item before salvaging it)');
      }
      items.push(BACK);
      return { title: 'ITEM', body, items };
    }

    case 'salvage': {
      const gear = listItems().filter((e) => e.meta && e.meta.slot);
      const byR = {};
      for (const e of gear) byR[e.meta.rarity] = (byR[e.meta.rarity] || 0) + e.qty;
      const body = [
        'Bulk-salvage inventory gear into scrap & essence.',
        `have: common ${byR.common || 0}, rare ${byR.rare || 0}, epic ${byR.epic || 0}, legendary ${byR.legendary || 0}`,
        'legendaries are spared here — salvage them one at a time (salvage <name>).',
      ];
      return {
        title: 'SALVAGE',
        body,
        items: [
          { label: 'Salvage all commons', hint: `${byR.common || 0} item(s)`, action: (s) => s.salvageAllRarity('common') },
          { label: 'Salvage all rares', hint: `${byR.rare || 0} item(s)`, action: (s) => s.salvageAllRarity('rare') },
          { label: 'Salvage all epics', hint: `${byR.epic || 0} item(s)`, action: (s) => s.salvageAllRarity('epic') },
          BACK,
        ],
      };
    }

    case 'autoscrap': {
      const c = getAutoScrap();
      const body = [
        'Drops whose rarity matches a rule are salvaged the instant you get them.',
        'A per-type rule overrides the "All types" fallback.',
      ];
      const items = AUTO_TYPES.map((t) => {
        let shown;
        if (t === 'all') shown = c.all.length ? c.all.join(',') : 'none';
        else shown = c.byType[t] ? (c.byType[t].length ? c.byType[t].join(',') : 'none') : '(uses all)';
        return { label: `${TYPE_LABELS[t]}: ${shown}`, action: (s) => s.openAutoScrapType(t) };
      });
      items.push(BACK);
      return { title: 'AUTO-SCRAP', body, items };
    }

    case 'autoscrap-type': {
      const t = shell.autoType || 'all';
      const c = getAutoScrap();
      const rule = t === 'all' ? c.all : c.byType[t] || [];
      const items = AUTO_RARITIES.map((r) => ({
        label: `[${rule.includes(r) ? 'x' : ' '}] ${r}`,
        action: (s) => s.toggleAutoScrapRarity(t, r),
      }));
      items.push({ label: t === 'all' ? 'Clear all' : 'Clear (fall back to All types)', action: (s) => s.clearAutoScrapType(t) });
      items.push(BACK);
      const body = [
        `Auto-scrap rules for: ${TYPE_LABELS[t]}`,
        t === 'all'
          ? 'applies to any item type without its own rule.'
          : 'no rarities here means this type falls back to the All-types rule.',
      ];
      return { title: 'AUTO-SCRAP', body, items };
    }

    case 'games': {
      const items = MINIGAMES.map((m, i) => ({
        key: m.key || String((i + 1) % 10),
        label: m.title,
        hint: m.desc,
        action: (s) => s.openMinigame(m.id),
      }));
      items.push(BACK);
      return {
        title: 'GAMES',
        body: MINIGAMES.length ? [] : ['(no minigames registered)'],
        items,
      };
    }

    case 'system':
      return {
        title: 'SYSTEM',
        body: [`Backend: ${getConfig().apiBase || '(offline / none configured)'}`],
        items: [
          { key: 'E', label: 'Export save', action: (s) => s.doExport() },
          { key: 'I', label: 'Import save', action: (s) => s.doImport() },
          { key: 'K', label: 'Backend status', action: (s) => s.pingBackend() },
          { key: 'S', label: 'Setting commands', action: (s) => s.navigate('settings') },
          { key: 'X', label: 'Reset save', action: (s) => s.confirmReset() },
          BACK,
        ],
      };

    case 'settings':
      return {
        title: 'SETTING COMMANDS',
        body: ['select a setting to print its command usage in the terminal:'],
        items: [
          { label: 'Theme', hint: 'change the colour theme', action: (s) => s.themeUsage() },
          {
            label: 'Animation',
            hint: 'enable/disable menu transitions',
            action: (s) => s.animationUsage(),
          },
          {
            label: 'Mobile view',
            hint: 'fit the UI to a phone screen',
            action: (s) => s.mobileViewUsage(),
          },
          {
            label: 'Terminal height',
            hint: 'lines shown in the terminal',
            action: (s) => s.termLinesUsage(),
          },
          {
            label: 'Log height',
            hint: 'lines shown in the game log',
            action: (s) => s.logLinesUsage(),
          },
          BACK,
        ],
      };

    default:
      return {
        title: 'UNKNOWN',
        body: [`No such screen: ${id}`],
        items: [BACK],
      };
  }
}

function progressBar(ratio, width) {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
}
