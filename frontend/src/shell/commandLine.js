// The terminal command line (bottom pane).
//
// Everything you type is echoed into the terminal transcript, then resolved:
//   - a bare NUMBER            → activates that menu option
//   - a reserved command word  → dispatched via the COMMANDS table below
//   - anything else            → matched against the current menu options by
//                                name (partial ok), or a top-level screen name
//
// So both "2" and "inv"/"inventory" open the Inventory, and plain menu use never
// needs the mouse.
//
// MAINTENANCE: commands are defined ONCE in the COMMANDS table — it drives both
// dispatch and the `help` listing, so there is no separate help list to keep in
// sync. To add or change a command, edit only that table.

import { MINIGAMES } from '../minigames/registry.js';

// Lines shown at the top of `help` describing menu navigation (not commands).
const NAV_HELP = [
  'navigation:',
  '  <number>             select that menu option',
  '  <name>               select by name, partial ok (e.g. "inv")',
];

/**
 * Every typed command. Each entry:
 *   names  – the word(s) that invoke it (first is canonical)
 *   usage  – help line(s); omit on alias-only entries so they aren't re-listed
 *   run    – (shell, args[], arg) => void   (arg = args joined by spaces)
 */
const COMMANDS = [
  {
    names: ['help'],
    usage: ['help                 show this help', 'help items           list all item modifiers and tiers'],
    run: (s, args) => ((args[0] || '').toLowerCase() === 'items' ? s.itemsHelp() : printHelp(s)),
  },
  {
    names: ['stats', 'stat'],
    usage: [
      'stats                open the stats screen',
      'stats help [stat]    stat growth, or one stat in detail',
      'stats add <s> <n>    allocate n points (e.g. stats add p.att 5)',
      'stats reset          refund all allocated points',
    ],
    run: (s, args) => {
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'help') s.statsHelp(args[1]);
      else if (sub === 'add') s.statsAdd(args[1], args[2]);
      else if (sub === 'reset') s.statsReset();
      else s.gotoStats(); // bare `stats` (or unknown sub) opens the screen
    },
  },
  {
    names: ['equip'],
    usage: 'equip <name>         equip an item from your inventory',
    run: (s, args, arg) => s.equipByName(arg),
  },
  {
    names: ['unequip'],
    usage: 'unequip <slot>       unequip a slot (head..feet, weapon1, weapon2)',
    run: (s, args) =>
      args[0]
        ? s.unequipSlot(args[0])
        : s.term('usage: unequip <slot>  (head, chest, hands, legs, feet, weapon1, weapon2)', 'is-warn'),
  },
  { names: ['next'], usage: 'next / prev          page through a long item list', run: (s) => s.nextPage() },
  { names: ['prev', 'previous'], run: (s) => s.prevPage() },
  {
    names: ['salvage'],
    usage: [
      'salvage <name>       break an item into scrap & essence',
      'salvage all <rarity> bulk-salvage a rarity (common|rare|epic|legendary|all)',
    ],
    run: (s, args, arg) =>
      (args[0] || '').toLowerCase() === 'all'
        ? s.salvageAllRarity((args[1] || 'common').toLowerCase())
        : s.salvageByName(arg),
  },
  { names: ['salvageall'], run: (s, args) => s.salvageAllRarity((args[0] || 'common').toLowerCase()) },
  {
    names: ['upgrade'],
    usage: 'upgrade <name>       upgrade a gear item (+N) with materials',
    run: (s, args, arg) => s.upgradeByName(arg),
  },
  {
    names: ['autoscrap'],
    usage: [
      'autoscrap            show auto-scrap rules',
      'autoscrap <type> <rarities>  e.g. autoscrap all common,rare  ·  autoscrap weapon none',
    ],
    run: (s, args) => s.autoScrapCmd(args),
  },
  {
    names: ['play'],
    usage: 'play <id>            launch a minigame',
    run: (s, args, arg) =>
      arg ? s.openMinigame(arg) : s.term('usage: play <id>. try: ' + minigameIds(), 'is-warn'),
  },
  { names: ['ls', 'games?'], usage: 'ls                   list minigame ids', run: (s) => s.term('minigames: ' + (minigameIds() || '(none)')) },
  { names: ['export'], usage: 'export | import      download / load a save file', run: (s) => s.doExport() },
  { names: ['import'], run: (s) => s.doImport() },
  { names: ['clear', 'cls'], usage: 'clear                clear this terminal', run: (s) => s.clearTerm() },
  { names: ['back'], usage: 'back / home          go up one menu / to the main menu', run: (s) => s.back() },
  { names: ['home', 'menu'], run: (s) => s.goRoot() },
  {
    names: ['theme'],
    usage: 'theme [colour]       show themes, or set one (e.g. theme blue)',
    run: (s, args, arg) => (arg ? s.setTheme(arg.toLowerCase()) : s.themeUsage()),
  },
  {
    names: ['animation', 'anim'],
    usage: 'animation [on|off]   show / set the menu transition animation',
    run: (s, args, arg) => (arg ? s.setAnimation(arg.toLowerCase()) : s.animationUsage()),
  },
  {
    names: ['mobileview', 'mobile'],
    usage: 'mobileview [on|off]  show / set the phone-friendly layout',
    run: (s, args, arg) => (arg ? s.setMobileView(arg.toLowerCase()) : s.mobileViewUsage()),
  },
  {
    names: ['termlines', 'termheight'],
    usage: 'termlines <n>        set terminal height (in lines)',
    run: (s, args, arg) => (arg ? s.setTermLines(arg) : s.termLinesUsage()),
  },
  {
    names: ['loglines', 'logheight'],
    usage: 'loglines <n>         set game log height (in lines)',
    run: (s, args, arg) => (arg ? s.setLogLines(arg) : s.logLinesUsage()),
  },
  { names: ['ping'], usage: 'ping                 check the configured backend', run: (s) => s.pingBackend() },
  {
    names: ['reset'],
    usage: 'reset [confirm]      wipe local save (asks first; "reset confirm" skips)',
    run: (s, args) => (['confirm', 'yes', 'y', '-y'].includes((args[0] || '').toLowerCase()) ? s.doReset() : s.confirmReset()),
  },
];

// name -> command entry (built once).
const COMMAND_MAP = {};
for (const c of COMMANDS) for (const n of c.names) COMMAND_MAP[n] = c;

const minigameIds = () => MINIGAMES.map((m) => m.id).join(', ');

function printHelp(shell) {
  NAV_HELP.forEach((l) => shell.term(l));
  shell.term('commands:');
  for (const c of COMMANDS) {
    if (!c.usage) continue;
    for (const line of Array.isArray(c.usage) ? c.usage : [c.usage]) shell.term('  ' + line);
  }
}

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

  const entry = COMMAND_MAP[cmd.toLowerCase()];
  if (entry) {
    entry.run(shell, args, arg);
    return;
  }

  // A bare number selects a menu option.
  if (args.length === 0 && /^\d+$/.test(cmd)) {
    shell.selectByNumber(Number(cmd));
    return;
  }

  // Otherwise match by name against the current menu / a screen.
  shell.resolveByName(raw);
}
