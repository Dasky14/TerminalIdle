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
      if ((args[0] || '').toLowerCase() === 'items') shell.itemsHelp();
      else HELP.forEach((line) => shell.term(line));
      return;
    case 'next':
      shell.nextPage();
      return;
    case 'prev':
    case 'previous':
      shell.prevPage();
      return;
    case 'equip':
      shell.equipByName(arg);
      return;
    case 'unequip':
      if (!arg) shell.term('usage: unequip <slot>  (head, chest, hands, legs, feet, weapon1, weapon2)', 'is-warn');
      else shell.unequipSlot(args[0]);
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
    case 'mobileview':
    case 'mobile':
      if (!arg) shell.mobileViewUsage();
      else shell.setMobileView(arg.toLowerCase());
      return;
    case 'termlines':
    case 'termheight':
      if (!arg) shell.termLinesUsage();
      else shell.setTermLines(arg);
      return;
    case 'loglines':
    case 'logheight':
      if (!arg) shell.logLinesUsage();
      else shell.setLogLines(arg);
      return;
    case 'ping':
      shell.pingBackend();
      return;
    case 'reset':
      shell.confirmReset();
      return;
    case 'stat':
    case 'stats': {
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'help') shell.statsHelp(args[1]);
      else if (sub === 'add') shell.statsAdd(args[1], args[2]);
      else if (sub === 'reset') shell.statsReset();
      else shell.gotoStats(); // bare `stats` (or unknown sub) opens the screen
      return;
    }
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
  '  help items           list all item modifiers and tiers',
  '  clear                clear this terminal',
  '  stats                open the stats screen',
  '  stats help           show stat growth per point',
  '  stats add <s> <n>    allocate n points to stat s (e.g. stats add p.att 5)',
  '  stats reset          refund all allocated points',
  '  equip <name>         equip an item from your inventory',
  '  unequip <slot>       unequip a slot (head..feet, weapon1, weapon2)',
  '  next / prev          page through a long item list',
  '  play <id>            launch a minigame',
  '  ls                   list minigame ids',
  '  export | import      download / load a save file',
  '  theme [colour]        show themes, or set one (e.g. theme blue)',
  '  animation [on|off]    show / set the menu transition animation',
  '  mobileview [on|off]   show / set the phone-friendly layout',
  '  termlines <n>         set terminal height (in lines)',
  '  loglines <n>          set game log height (in lines)',
  '  ping                 check the configured backend',
  '  reset                wipe local save',
];
