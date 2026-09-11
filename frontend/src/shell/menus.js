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
import { STAT_DEFS, COMBAT_STATS, statValue, statGrowth, formatStat } from '../game/stats.js';
import {
  EQUIP_SLOTS,
  SLOT_LABELS,
  listForSlot,
  isWeapon2Blocked,
  equipmentBonuses,
  locateItem,
} from '../game/equipment.js';
import {
  describeStats,
  compareItems,
  itemEffects,
  itemDisplayName,
  itemName,
  itemUpgradeLevel,
} from '../game/items.js';
import { combatProfile, derivedStats, effectiveStats } from '../game/character.js';
import { salvageYield, getAutoScrap, AUTO_TYPES, AUTO_RARITIES } from '../game/salvage.js';
import { isUpgradeable, upgradeCost, canUpgrade, itemOrientation, countDuplicates } from '../game/upgrade.js';

const BACK = { key: 'B', label: 'Back', action: (shell) => shell.back() };

const PAGE_SIZE = 15;

// Human labels for auto-scrap "types" (equip slots + the 'all' fallback).
const TYPE_LABELS = {
  all: 'All types', head: 'Head', chest: 'Chest', hands: 'Hands',
  legs: 'Legs', feet: 'Feet', weapon: 'Weapons',
};
const handsLabel = (h) => (h === 2 ? 'two-handed' : h === 'off' ? 'off-hand' : 'one-handed');
const handsShort = (h) => (h === 2 ? '2H' : h === 'off' ? 'Off-hand' : '1H');

// Idle-time cap for the root dashboard (mirrors the away-reward cap).
const AWAY_CAP_MS = 24 * 60 * 60 * 1000;

/** Compact duration: "3h 12m" / "12m" / "45s". */
function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.max(0, s)}s`;
}

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
    case 'root': {
      // The sidebar already covers navigation, so the main menu is now an
      // at-a-glance dashboard: level/XP and per-minigame idle time waiting to be
      // collected on next open.
      const snap = levelSnapshot();
      const body = [
        `Level ${snap.level}    XP ${snap.xpIntoLevel} / ${snap.xpForNext}  (${(snap.progress * 100).toFixed(0)}%)`,
        '',
        'MINIGAMES — idle progress waiting to be collected:',
      ];
      const meta = state.minigameMeta || {};
      const now = Date.now();
      if (!MINIGAMES.length) {
        body.push('  (no minigames registered)');
      } else {
        for (const m of MINIGAMES) {
          const last = meta[m.id] && meta[m.id].lastOpen;
          let idleStr;
          if (!last) {
            idleStr = 'not started';
          } else {
            const elapsed = now - last;
            idleStr = `idle ${fmtDuration(Math.min(elapsed, AWAY_CAP_MS))}${elapsed > AWAY_CAP_MS ? ' (max)' : ''}`;
          }
          body.push(`  ${m.title.padEnd(18)} ${idleStr}`);
        }
      }
      return { title: 'MAIN MENU', body, items: [] };
    }

    case 'stats': {
      const snap = levelSnapshot();
      // Two layers: allocatable CHARACTERISTICS, and the COMBAT stats they derive
      // (plus equipment). derived = from characteristics only; eff = with gear.
      const derived = derivedStats();
      const eff = effectiveStats();
      const prof = combatProfile();
      const atkStr = prof.attacks.map((a) => `${a.mult}x ${a.type}`).join(' + ');

      const view = [
        {
          t: 'headline',
          left: `LEVEL ${snap.level}`,
          right: `${state.statPoints} POINTS`,
        },
        {
          t: 'meter',
          label: `XP ${snap.xpIntoLevel} / ${snap.xpForNext}`,
          sub: `${(snap.progress * 100).toFixed(0)}%`,
          fill: snap.progress,
        },
        {
          t: 'cols',
          cols: [
            {
              title: 'Characteristics',
              rows: STAT_DEFS.map((d) => {
                const pts = state.stats[d.id] || 0;
                return { name: d.name, value: formatStat(d, statValue(d, pts)), note: `${pts} pt` };
              }),
            },
            {
              title: 'Combat',
              titleNote: '+gear',
              rows: COMBAT_STATS.map((c) => {
                const total = eff[c.id] || 0;
                const gear = total - (derived[c.id] || 0);
                return {
                  name: c.abbr,
                  value: formatStat(c, total),
                  note: gear > 0.0001 ? `+${formatStat(c, gear)}` : '',
                  noteGear: true,
                };
              }),
            },
          ],
        },
        { t: 'line', text: `Attacks: ${atkStr}  (${prof.label})`, cls: 'is-strong' },
      ];
      if (prof.defenseMult > 1) {
        view.push({
          t: 'line',
          text: `Defense: +${Math.round((prof.defenseMult - 1) * 100)}% from shield`,
          cls: 'is-warn',
        });
      }
      return {
        title: 'STATS',
        view,
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
        hint: `+${statGrowth(d).perPoint}/pt · type "${d.aliases[0]}"`,
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
          .filter((it) => shell.matchesInvFilter(it))
          .sort(compareItems);
        const { slice, page, pages, total } = paginate(shell, gear);
        const fcount = shell.invFilterActiveCount();
        const headerActions = [
          {
            label: fcount ? `Filters (${fcount})` : 'Filters',
            active: shell.invFilterOpen || fcount > 0,
            act: (s) => s.toggleInvFilter(),
          },
        ];
        const items = [...pageItems(page, pages), BACK];
        if (!total) {
          const view = [];
          if (shell.invFilterOpen) view.push({ t: 'filter' });
          view.push({ t: 'note', text: fcount ? 'no items match the current filters' : '(no equipment yet)' });
          return { title: 'INVENTORY / EQUIPMENT', view, headerActions, items };
        }
        const rows = slice.map((it) => ({
          uid: it.uid,
          cells: [
            { text: itemName(it), cls: 'sv-nm', up: itemUpgradeLevel(it) },
            { rarity: it.rarity },
            { text: it.slot === 'weapon' ? `${handsShort(it.hands)} Weapon` : SLOT_LABELS[it.slot] || it.slot, cls: 'sv-dim' },
            { text: describeStats(it), cls: 'sv-stat' },
          ],
          actions: [
            { label: 'Equip', kind: 'equip' },
            { label: 'Salvage', kind: 'salvage' },
          ],
        }));
        const view = [];
        if (shell.invFilterOpen) view.push({ t: 'filter' });
        view.push({
          t: 'note',
          text: `Page ${page + 1}/${pages} · ${total} item${total === 1 ? '' : 's'}${fcount ? ' (filtered)' : ''} · click a row for details`,
        });
        view.push({ t: 'table', head: ['Item', 'Rarity', 'Slot', 'Stats', ''], rows });
        return { title: 'INVENTORY / EQUIPMENT', view, headerActions, items };
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
      const bonusStr = COMBAT_STATS.filter((d) => bonuses[d.id])
        .map((d) => `+${formatStat(d, bonuses[d.id])} ${d.abbr}`)
        .join('  ');
      const rows = EQUIP_SLOTS.map((slot) => {
        const it = eq[slot];
        let itemCell;
        if (slot === 'weapon2' && isWeapon2Blocked()) itemCell = { text: '— (2H equipped)', cls: 'sv-dim' };
        else if (it) itemCell = { text: itemName(it), cls: 'sv-nm', up: itemUpgradeLevel(it) };
        else itemCell = { text: '(empty)', cls: 'sv-dim' };
        return {
          uid: it ? it.uid : null,
          cells: [
            { text: SLOT_LABELS[slot], cls: 'sv-dim' },
            itemCell,
            { text: it ? describeStats(it) : '', cls: 'sv-stat' },
          ],
        };
      });
      const view = [
        {
          t: 'note',
          text: bonusStr
            ? `Total bonuses: ${bonusStr}`
            : 'click a slot to view stats, upgrade, or unequip · equip gear from Inventory',
        },
        { t: 'table', head: ['Slot', 'Item', 'Stats'], rows },
      ];
      return { title: 'EQUIPMENT', view, items: [BACK] };
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
      if (isUpgradeable(it)) body.push(`Orientation: ${itemOrientation(it)}  (upgrades cost ${upgradeCost(it).resource})`);
      body.push(`Salvage value: +${y.scrap} scrap, +${y.essence} essence`);

      const items = [];
      if (loc.where === 'inventory') items.push({ label: 'Equip', action: (s) => s.equipDetail(shell.itemUid) });
      else items.push({ label: 'Unequip', action: (s) => s.unequipSlot(loc.slot) });

      if (isUpgradeable(it)) {
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
        items.push({ label: 'Salvage', hint: `+${y.scrap} scrap / +${y.essence} essence`, action: (s) => s.salvageOne(shell.itemUid, true) });
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

    case 'reset-confirm':
      return {
        title: 'RESET SAVE',
        body: [
          'This erases ALL local progress: level, stats, equipment, inventory,',
          'resources, and minigame progress. This cannot be undone.',
          '(tip: System -> Export save first if you want a backup.)',
        ],
        items: [
          { label: 'Yes — erase everything', action: (s) => s.doReset() },
          { label: 'Cancel', action: (s) => s.back() },
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
            label: 'UI scale',
            hint: 'zoom the sidebar + content',
            action: (s) => s.uiScaleUsage(),
          },
          {
            label: 'Frame width',
            hint: 'free space for game windows',
            action: (s) => s.frameWidthUsage(),
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
