// The terminal command line (bottom pane).
//
// Everything you type is echoed into the terminal transcript, then resolved:
//   - a bare NUMBER            → activates that menu option
//   - a reserved command word  → help / clear / play / export / ... (below)
//   - anything else            → matched against the current menu options by
//                                name (partial ok), or a top-level screen name
//
// So both "2" and "inv"/"inventory" open the Inventory, and plain menu use never
// needs the mouse.

import { MINIGAMES } from '../minigames/registry.js';

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
    }
  });
}

function run(shell, raw) {
  shell.term(`user@til:~$ ${raw}`, 'is-echo');
  const [cmd, ...args] = raw.split(/\s+/);
  const arg = args.join(' ');
  const lc = cmd.toLowerCase();

  // Reserved command words take priority over name matching.
  switch (lc) {
    case 'help':
      HELP.forEach((line) => shell.term(line));
      return;
    case 'clear':
    case 'cls':
      shell.clearTerm();
      return;
    case 'back':
      shell.back();
      return;
    case 'home':
    case 'menu':
      shell.goRoot();
      return;
    case 'play':
      if (!arg) {
        shell.term('usage: play <id>. try: ' + MINIGAMES.map((m) => m.id).join(', '), 'is-warn');
      } else {
        shell.openMinigame(arg);
      }
      return;
    case 'ls':
    case 'games?':
      shell.term('minigames: ' + (MINIGAMES.map((m) => m.id).join(', ') || '(none)'));
      return;
    case 'export':
      shell.doExport();
      return;
    case 'import':
      shell.doImport();
      return;
    case 'theme':
      if (!arg) shell.themeUsage();
      else shell.setTheme(arg.toLowerCase());
      return;
    case 'animation':
    case 'anim':
      if (!arg) shell.animationUsage();
      else shell.setAnimation(arg.toLowerCase());
      return;
    case 'ping':
      shell.pingBackend();
      return;
    case 'reset':
      shell.confirmReset();
      return;
    default:
      break;
  }

  // A bare number selects a menu option.
  if (args.length === 0 && /^\d+$/.test(cmd)) {
    shell.selectByNumber(Number(cmd));
    return;
  }

  // Otherwise match by name against the current menu / a screen.
  shell.resolveByName(raw);
}

const HELP = [
  'navigation:',
  '  <number>             select that menu option',
  '  <name>               select by name, partial ok (e.g. "inv")',
  '  back / home          go up one menu / to the main menu',
  'commands:',
  '  help                 show this help',
  '  clear                clear this terminal',
  '  play <id>            launch a minigame',
  '  ls                   list minigame ids',
  '  export | import      download / load a save file',
  '  theme [colour]        show themes, or set one (e.g. theme blue)',
  '  animation [on|off]    show / set the menu transition animation',
  '  ping                 check the configured backend',
  '  reset                wipe local save',
];
