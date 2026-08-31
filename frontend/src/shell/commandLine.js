// The optional typed command line.
//
// Navigation is fully doable with menus (letters / arrows / mouse); this bar is
// for power users and keeps the terminal feel. Commands are intentionally few.

import { MINIGAMES } from '../minigames/registry.js';

/**
 * @param {import('./shell.js').Shell} shell
 */
export function attachCommandLine(shell) {
  const input = shell.$input;
  const history = [];
  let historyPos = -1;

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = input.value.trim();
      input.value = '';
      if (!raw) return;
      history.push(raw);
      historyPos = history.length;
      run(shell, raw);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length && historyPos > 0) {
        historyPos -= 1;
        input.value = history[historyPos];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyPos < history.length - 1) {
        historyPos += 1;
        input.value = history[historyPos];
      } else {
        historyPos = history.length;
        input.value = '';
      }
    } else if (e.key === 'Escape') {
      // Let Escape leave the command line so menu nav resumes.
      input.blur();
    }
  });
}

function run(shell, raw) {
  const [cmd, ...args] = raw.split(/\s+/);
  const arg = args.join(' ');
  shell.print(`$ ${raw}`, 'is-echo');

  switch (cmd.toLowerCase()) {
    case 'help':
      HELP.forEach((line) => shell.print(line));
      break;
    case 'clear':
      shell.log = [];
      shell.render();
      break;
    case 'back':
      shell.back();
      break;
    case 'home':
    case 'root':
      shell.goRoot();
      break;
    case 'menu': // jump straight to a screen
      shell.navigate(arg || 'root');
      break;
    case 'games':
      shell.goRoot();
      shell.navigate('games');
      break;
    case 'stats':
    case 'inventory':
    case 'resources':
    case 'system':
      shell.goRoot();
      shell.navigate(cmd.toLowerCase());
      break;
    case 'play':
      if (!arg) {
        shell.print('Usage: play <id>. Try: ' + MINIGAMES.map((m) => m.id).join(', '), 'is-warn');
      } else {
        shell.openMinigame(arg);
      }
      break;
    case 'ls':
      shell.print('Minigames: ' + (MINIGAMES.map((m) => m.id).join(', ') || '(none)'));
      break;
    case 'export':
      shell.doExport();
      break;
    case 'import':
      shell.doImport();
      break;
    case 'theme':
      shell.toggleTheme();
      break;
    case 'ping':
      shell.pingBackend();
      break;
    case 'reset':
      shell.confirmReset();
      break;
    default:
      shell.print(`Unknown command: ${cmd}. Type 'help'.`, 'is-error');
  }
}

const HELP = [
  'Commands:',
  '  help                 show this help',
  '  clear                clear the log',
  '  back / home          navigate up / to main menu',
  '  stats | inventory | resources | system    jump to a screen',
  '  games                open the games menu',
  '  ls                   list minigame ids',
  '  play <id>            launch a minigame in a window',
  '  export | import      download / load a save file',
  '  theme                cycle color theme',
  '  ping                 check the configured backend',
  '  reset                wipe local save',
  'Tip: you can also navigate entirely with letters, arrows+Enter, or the mouse.',
];
