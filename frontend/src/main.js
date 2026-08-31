// Bootstrap: load runtime config, restore the save, mount the shell, and wire
// keyboard + command-line input.

import './styles/terminal.css';
import './styles/windows.css';

import { loadConfig } from './config.js';
import { loadFromStorage, enableAutosave } from './game/save.js';
import { WindowManager } from './windows/windowManager.js';
import { Shell } from './shell/shell.js';
import { attachInput } from './shell/input.js';
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
      if (summary.levelsGained) parts.push(`LEVEL UP x${summary.levelsGained}!`);
      for (const [k, v] of Object.entries(summary.resources || {})) parts.push(`+${v} ${k}`);
      for (const it of summary.items || []) parts.push(`+${it.qty} ${it.id}`);
      if (parts.length && shell) {
        shell.print(`[${summary.source}] ${parts.join('  ')}`, 'is-ok');
      }
    },
  });

  // 4. The menu-driven shell.
  const screenRoot = document.getElementById('screen');
  shell = new Shell(screenRoot, windowManager);
  attachInput(shell);
  attachCommandLine(shell);
  shell.render();

  if (fresh) {
    shell.print('Welcome! New save created. Open Games to start earning rewards.', 'is-ok');
  } else {
    shell.print('Save loaded.', 'is-ok');
  }
}

main().catch((err) => {
  console.error('Fatal boot error:', err);
  document.getElementById('screen').textContent = 'Failed to start: ' + err.message;
});
