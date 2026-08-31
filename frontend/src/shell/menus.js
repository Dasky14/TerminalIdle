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

const BACK = { key: 'B', label: 'Back', action: (shell) => shell.back() };

export function buildScreen(id, shell) {
  switch (id) {
    case 'root':
      return {
        title: 'MAIN MENU',
        body: [],
        items: [
          { key: 'S', label: 'Stats', action: (s) => s.navigate('stats') },
          { key: 'I', label: 'Inventory', action: (s) => s.navigate('inventory') },
          { key: 'R', label: 'Resources', action: (s) => s.navigate('resources') },
          { key: 'G', label: 'Games', action: (s) => s.navigate('games') },
          { key: 'Y', label: 'System', action: (s) => s.navigate('system') },
        ],
      };

    case 'stats': {
      const snap = levelSnapshot();
      const bar = progressBar(snap.progress, 24);
      return {
        title: 'STATS',
        body: [
          `Level    : ${snap.level}`,
          `XP       : ${snap.xpIntoLevel} / ${snap.xpForNext}`,
          `Progress : ${bar} ${(snap.progress * 100).toFixed(0)}%`,
        ],
        items: [BACK],
      };
    }

    case 'inventory': {
      const items = listItems();
      const body = items.length
        ? items.map((it) => `${String(it.qty).padStart(4)}x  ${it.name}`)
        : ['(empty — play a minigame to earn items)'];
      return { title: 'INVENTORY', body, items: [BACK] };
    }

    case 'resources': {
      const res = listResources();
      const keys = Object.keys(res);
      const body = keys.length
        ? keys.map((k) => `${k.padEnd(12)} ${res[k]}`)
        : ['(no resources yet)'];
      return { title: 'RESOURCES', body, items: [BACK] };
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
