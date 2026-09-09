// Bootstrap: load runtime config, restore the save, mount the shell, and wire
// keyboard + command-line input.

import './styles/terminal.css';
import './styles/windows.css';

import { loadConfig } from './config.js';
import { loadFromStorage, enableAutosave } from './game/save.js';
import { pointsPerLevel } from './game/leveling.js';
import { loadBalance } from './game/balance.js';
import { loadItems } from './game/items-data.js';
import { WindowManager } from './windows/windowManager.js';
import { Shell } from './shell/shell.js';
import { attachCommandLine } from './shell/commandLine.js';

async function main() {
  // 1. Runtime config (backend address, etc.) — read before anything uses it.
  await loadConfig();

  // 2. Game balance (stat growth, costs, drop rates, …) and the item catalogue
  //    (weapons, modifiers, legendaries, effects). Both depend on config for the
  //    optional backend override, and must resolve before anything computes
  //    stats, generates items, or runs save migrations.
  await Promise.all([loadBalance(), loadItems()]);

  // 3. Restore or create the save, then keep it persisted.
  const { fresh } = loadFromStorage();
  enableAutosave();

  // 3. Window manager (floating minigame windows) → routes rewards to the shell.
  const windowsRoot = document.getElementById('windows');
  let shell; // declared first so the reward hook can reference it
  const windowManager = new WindowManager(windowsRoot, {
    onReward: (summary) => {
      const parts = [];
      if (summary.xp) parts.push(`+${summary.xp} XP`);
      if (summary.levelsGained) {
        parts.push(`LEVEL UP x${summary.levelsGained}! (+${summary.levelsGained * pointsPerLevel()} pts)`);
      }
      for (const [k, v] of Object.entries(summary.resources || {})) {
        if (v) parts.push(`+${v} ${k}`);
      }
      const items = summary.items || [];
      if (items.length > 6) {
        // A big batch (e.g. banked idle drops) — collapse to a count.
        parts.push(`got ${items.length} items`);
      } else {
        for (const it of items) {
          parts.push(it.name ? `got ${it.rarity ? `[${it.rarity}] ` : ''}${it.name}` : `+${it.qty} ${it.id}`);
        }
      }
      if (summary.scrapped) parts.push(`auto-scrapped ${summary.scrapped}`);
      if (parts.length && shell) {
        // Minigame rewards go to the running GAME LOG (middle pane).
        shell.logGame(`[${summary.source}] ${parts.join('  ')}`, 'is-ok');
      }
    },
  });

  // 4. The menu-driven shell.
  const screenRoot = document.getElementById('screen');
  shell = new Shell(screenRoot, windowManager);
  attachCommandLine(shell);
  shell.render();

  // Boot messages are system output → the TERMINAL transcript (bottom pane).
  if (fresh) {
    shell.term('welcome — new save created. type a number/name or click to begin.', 'is-ok');
  } else {
    shell.term('save loaded.', 'is-ok');
  }
}

main().catch((err) => {
  console.error('Fatal boot error:', err);
  document.getElementById('screen').textContent = 'Failed to start: ' + err.message;
});
