// Bootstrap: load runtime config, restore the save, mount the shell, and wire
// keyboard + command-line input.

import './styles/terminal.css';
import './styles/windows.css';

import { loadConfig } from './config.js';
import { loadFromStorage, enableAutosave } from './game/save.js';
import { POINTS_PER_LEVEL } from './game/leveling.js';
import { WindowManager } from './windows/windowManager.js';
import { Shell } from './shell/shell.js';
import { attachCommandLine } from './shell/commandLine.js';

async function main() {
  // 1. Runtime config (backend address, etc.) — read before anything uses it.
  await loadConfig();

  // 2. Restore or create the save, then keep it persisted.
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
        parts.push(`LEVEL UP x${summary.levelsGained}! (+${summary.levelsGained * POINTS_PER_LEVEL} pts)`);
      }
      for (const [k, v] of Object.entries(summary.resources || {})) parts.push(`+${v} ${k}`);
      for (const it of summary.items || []) {
        parts.push(it.name ? `got ${it.rarity ? `[${it.rarity}] ` : ''}${it.name}` : `+${it.qty} ${it.id}`);
      }
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
