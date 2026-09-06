// The shell: a three-part terminal UI.
//
//   1. MENU (top)      — numbered, clickable options + info (stats/inventory).
//                        Redraws with a clear-then-print animation on navigation.
//   2. GAME LOG (mid)  — a running feed of things happening in minigames
//                        (XP, resources, items gained). Persists across menus.
//   3. TERMINAL (bot)  — what you've typed and the system's responses. Does NOT
//                        clear when the menu changes. The command input lives here.
//
// Navigation is by the terminal, not by letter hotkeys:
//   - type an item's NUMBER and press Enter, or
//   - type its NAME (partial or full), e.g. "inv" / "inventory", or
//   - click the option in the menu.

import { buildScreen } from './menus.js';
import { onChange, state } from '../game/state.js';
import { getMinigame } from '../minigames/registry.js';
import { exportSave, importSave, resetSave } from '../game/save.js';
import { getConfig } from '../config.js';
import { allocate, resetStats } from '../game/character.js';
import { STAT_DEFS, statValue, formatStat, findStat } from '../game/stats.js';
import { POINTS_PER_LEVEL } from '../game/leveling.js';
import {
  equipByUid,
  equipInSlotByUid,
  unequip,
  findEquippableByName,
  EQUIP_SLOTS,
  SLOT_LABELS,
} from '../game/equipment.js';
import { modifierHelpLines, rarityChances } from '../game/items.js';
import { effectiveStats } from '../game/character.js';

const THEME_KEY = 'til.theme';
const THEMES = ['green', 'amber', 'blue', 'white'];
const ANIM_KEY = 'til.anim';
const MOBILE_KEY = 'til.mobile';
const TERMLINES_KEY = 'til.termlines';
const LOGLINES_KEY = 'til.loglines';
const DEFAULT_TERMLINES = 14;
const DEFAULT_LOGLINES = 3;
const MIN_LINES = 1;
const MAX_LINES = 50;
const ANIM_ON = ['on', 'enable', 'enabled', 'true', 'yes'];
const ANIM_OFF = ['off', 'disable', 'disabled', 'false', 'no'];
const PRINT_DELAY_MS = 12;
const RULE = '-'.repeat(58);
const MAX_TERM = 300;
const MAX_GAMELOG = 80;

// Top-level screens reachable by name from anywhere in the terminal.
const GLOBAL_SCREENS = ['stats', 'equipment', 'inventory', 'resources', 'games', 'system'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Shell {
  constructor(root, windowManager) {
    this.root = root;
    this.windowManager = windowManager;
    this.stack = ['root'];
    this.screen = null;
    this._renderGen = 0;

    this.termLines = []; // bottom terminal transcript
    this.gameLog = []; // middle game-event feed

    // On touch devices we must NOT auto-focus / refocus the input, or the
    // on-screen keyboard pops open and shoves the fixed-height layout out of
    // view. Typing still works — the user taps the input line to focus it.
    this.isTouch =
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      navigator.maxTouchPoints > 0;

    this._buildChrome();
    this._applyStoredTheme();
    this.animEnabled = this._loadAnimation();

    // Mobile view: fits the UI to a phone and switches minigame windows from
    // draggable panels to a stacked overlay. Defaults to on for touch devices.
    this.mobileView = this._loadMobileView();
    document.documentElement.dataset.mobile = this.mobileView ? 'on' : 'off';
    this.windowManager.setMobile(this.mobileView);

    // Pane heights (game log / terminal) are measured in lines and adjustable.
    this._loadLayout();

    // Live screens (stats/inventory/...) redraw instantly when state changes.
    onChange(() => {
      if (
        [
          'stats',
          'stats-allocate',
          'equipment',
          'equip-slot',
          'inventory',
          'inventory-cat',
          'resources',
          'system',
        ].includes(this.currentId)
      ) {
        this.render(false);
      }
    });

    if (!this.isTouch) this.$input.focus();
  }

  get currentId() {
    return this.stack[this.stack.length - 1];
  }

  _buildChrome() {
    this.root.innerHTML = `
      <div class="shell">
        <section class="pane pane--menu">
          <div class="term__out" tabindex="-1"></div>
        </section>
        <section class="pane pane--gamelog">
          <div class="pane__label">game log</div>
          <div class="gamelog"></div>
        </section>
        <section class="pane pane--term">
          <div class="pane__label">terminal</div>
          <div class="termout"></div>
          <div class="term__cmdline">
            <span class="term__prompt">user@til:~$</span>
            <span class="term__blink" aria-hidden="true"></span>
            <input class="term__input" type="text" spellcheck="false"
                   autocomplete="off" aria-label="command line" />
          </div>
        </section>
      </div>
    `;
    this.$out = this.root.querySelector('.term__out');
    this.$gamelog = this.root.querySelector('.gamelog');
    this.$termout = this.root.querySelector('.termout');
    this.$input = this.root.querySelector('.term__input');

    // On desktop, clicking anywhere in the terminal focuses the input (unless
    // the user is selecting text) for convenience. On touch we skip this so
    // tapping a menu option doesn't reopen the keyboard. Minigame windows live
    // outside this root, so this never steals focus from a running game.
    if (!this.isTouch) {
      this.root.addEventListener('click', () => {
        const sel = window.getSelection && window.getSelection().toString();
        if (!sel) this.$input.focus();
      });
    }
  }

  // --- Navigation ----------------------------------------------------------
  navigate(id) {
    this.stack.push(id);
    this.render(true);
  }

  back() {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.render(true);
    }
  }

  goRoot() {
    this.stack = ['root'];
    this.render(true);
  }

  // --- Selecting menu items (by number / name / click) ---------------------
  /** Activate the item at 1-based position n. Used by typed numbers & clicks. */
  selectByNumber(n) {
    const items = this.screen ? this.screen.items : [];
    if (n >= 1 && n <= items.length) {
      items[n - 1].action(this);
      return true;
    }
    this.term(`no menu option ${n}`, 'is-error');
    return false;
  }

  /** Resolve typed text to a menu item by name (partial ok), else a screen. */
  resolveByName(raw) {
    const q = raw.toLowerCase().trim();
    const items = this.screen ? this.screen.items : [];
    const matches = items.filter((it) => {
      const label = it.label.toLowerCase();
      return label.startsWith(q) || label.split(/\s+/).some((w) => w.startsWith(q));
    });

    if (matches.length === 1) {
      matches[0].action(this);
      return true;
    }
    if (matches.length > 1) {
      this.term(`ambiguous: ${matches.map((m) => m.label).join(', ')}`, 'is-warn');
      return false;
    }

    // Fall back to jumping to a top-level screen by name from anywhere.
    const screen = GLOBAL_SCREENS.find((s) => s.startsWith(q));
    if (screen) {
      if (this.currentId !== screen) {
        this.goRoot();
        this.navigate(screen);
      }
      return true;
    }

    this.term(`unknown: ${raw}  (type 'help')`, 'is-error');
    return false;
  }

  // --- Rendering the menu pane --------------------------------------------
  async render(animate = true) {
    this.screen = buildScreen(this.currentId, this);
    const lines = this._composeLines();
    const gen = ++this._renderGen;
    this.$out.innerHTML = '';

    // The animation setting can force an instant redraw.
    if (!animate || !this.animEnabled) {
      for (const entry of lines) this.$out.appendChild(this._makeNode(entry));
      return;
    }
    for (const entry of lines) {
      if (gen !== this._renderGen) return;
      this.$out.appendChild(this._makeNode(entry));
      this.$out.scrollTop = this.$out.scrollHeight;
      await sleep(entry.t === 'gap' ? 0 : PRINT_DELAY_MS);
    }
  }

  _composeLines() {
    const s = this.screen;
    const lines = [];
    if (this.currentId === 'root') {
      const banner = this.mobileView ? COMPACT_BANNER_LINES : BANNER_LINES;
      for (const bl of banner) lines.push({ t: 'banner', text: bl });
      lines.push({
        t: 'dim',
        text: this.mobileView
          ? '  a menu-driven game shell'
          : '        terminal idle :: a menu-driven game shell',
      });
    } else {
      lines.push({ t: 'head', text: `:: ${s.title}` });
    }
    lines.push({ t: 'rule', text: RULE });

    for (const b of s.body || []) lines.push({ t: 'text', text: b });
    if (s.body && s.body.length) lines.push({ t: 'gap', text: '' });

    s.items.forEach((it, i) =>
      lines.push({ t: 'item', num: i + 1, label: it.label, hint: it.hint }),
    );

    lines.push({ t: 'gap', text: '' });
    lines.push({ t: 'hint', text: 'type a number or name below, or click an option' });
    return lines;
  }

  _makeNode(entry) {
    const div = document.createElement('div');
    div.className = 'term__line';

    if (entry.t === 'item') {
      div.classList.add('term__line--item');
      const num = document.createElement('span');
      num.className = 'term__num';
      num.textContent = `${String(entry.num).padStart(2)}) `;
      const text = document.createElement('span');
      text.className = 'term__itext';
      text.textContent = entry.label;
      div.append(num, text);
      if (entry.hint) {
        const hint = document.createElement('span');
        hint.className = 'term__ihint';
        hint.textContent = `  - ${entry.hint}`;
        div.appendChild(hint);
      }
      div.addEventListener('click', () => {
        // Echo the item's name — the same text you'd type to run it.
        this.term(`user@til:~$ ${entry.label.toLowerCase()}`, 'is-echo');
        this.selectByNumber(entry.num);
      });
    } else {
      div.classList.add(`term__line--${entry.t}`);
      div.textContent = entry.text === '' ? ' ' : entry.text;
    }
    return div;
  }

  // --- Terminal transcript (bottom) ---------------------------------------
  term(text, cls = '') {
    this.termLines.push({ text, cls });
    if (this.termLines.length > MAX_TERM) this.termLines.shift();
    this._renderTerm();
  }

  clearTerm() {
    this.termLines = [];
    this._renderTerm();
  }

  _renderTerm() {
    this.$termout.innerHTML = this.termLines
      .map((l) => `<div class="term__tline ${l.cls}">${escapeHtml(l.text)}</div>`)
      .join('');
    this.$termout.scrollTop = this.$termout.scrollHeight;
  }

  // --- Game log (middle) ---------------------------------------------------
  logGame(text, cls = '') {
    this.gameLog.push({ text, cls });
    if (this.gameLog.length > MAX_GAMELOG) this.gameLog.shift();
    this.$gamelog.innerHTML = this.gameLog
      .map((l) => `<div class="gl__line ${l.cls}">${escapeHtml(l.text)}</div>`)
      .join('');
    this.$gamelog.scrollTop = this.$gamelog.scrollHeight;
  }

  // --- Actions -------------------------------------------------------------
  openMinigame(id) {
    const mg = getMinigame(id);
    if (!mg) {
      this.term(`no such minigame: ${id}`, 'is-error');
      return;
    }
    this.windowManager.open(mg);
    this.term(`launched "${mg.title}"`, 'is-ok');
    this.logGame(`>> started ${mg.title}`, 'is-ok');
  }

  // --- Character stats -----------------------------------------------------
  /** Jump to the stats screen (used by the bare `stats` command). */
  gotoStats() {
    this.stack = this.currentId === 'stats' ? this.stack : ['root', 'stats'];
    this.render(true);
  }

  /** `stats add <stat> <points>` — allocate (or, with a negative, refund). */
  statsAdd(statInput, amountInput) {
    if (!statInput || amountInput == null) {
      this.term('usage: stats add <stat> <points>   (e.g. stats add p.att 5)', 'is-warn');
      return;
    }
    const res = allocate(statInput, amountInput);
    if (!res.ok) {
      this.term(res.error, 'is-error');
      return;
    }
    const verb = res.added >= 0 ? `+${res.added} to` : `${res.added} from`;
    this.term(
      `${verb} ${res.def.abbr} -> ${formatStat(res.def, res.value)}  (points left: ${res.points})`,
      'is-ok',
    );
  }

  /** `stats reset` — refund every allocated point. */
  statsReset() {
    const { refunded, points } = resetStats();
    this.term(`respec: refunded ${refunded} points (available: ${points})`, 'is-ok');
  }

  /** `stats help [stat]` — the growth table, or one stat's description. */
  statsHelp(statArg) {
    if (statArg) {
      const d = findStat(statArg);
      if (!d) {
        this.term(`unknown stat: ${statArg}  (try 'stats help')`, 'is-error');
        return;
      }
      this.term(`${d.name}  (${d.aliases[0]})`, 'is-warn');
      this.term(`base ${formatStat(d, d.base)}   ·   +${d.perPoint} per point`);
      const lines = Array.isArray(d.help) ? d.help : d.help ? [d.help] : [];
      for (const l of lines) this.term('  ' + l);
      if (d.id === 'luck') {
        const luck = effectiveStats().luck || 0;
        const c = rarityChances(luck);
        const p = (x) => (x * 100).toFixed(2) + '%';
        this.term(
          `  at your Luck (${luck}): legendary ${p(c.legendary)}, epic ${p(c.epic)}, ` +
            `rare ${p(c.rare)}, common ${p(c.common)}`,
        );
      }
      return;
    }
    this.term(`character stats — you gain ${POINTS_PER_LEVEL} points per level.`, 'is-warn');
    this.term('allocate:  stats add <stat> <points>     (e.g. stats add p.att 5)');
    this.term('remove:    stats add <stat> -<points>    respec: stats reset');
    this.term(`points available: ${state.statPoints}`);
    this.term('growth per point:');
    for (const d of STAT_DEFS) {
      const key = d.aliases[0].padEnd(10);
      const per = `+${d.perPoint}/pt`.padEnd(8);
      this.term(`  ${key} ${per} base ${formatStat(d, d.base).padEnd(6)} ${d.name}`);
    }
    this.term("details:  stats help <stat>   (e.g. stats help dodge)");
  }

  // --- Equipment -----------------------------------------------------------
  /** Equip an inventory item by uid (used by the Equipment menu). */
  equipItem(uid) {
    const it = equipByUid(uid);
    if (!it) {
      this.term('item not found', 'is-error');
      return;
    }
    this.term(`equipped ${it.name}`, 'is-ok');
  }

  /** Open the slot-detail screen for a chosen equipment slot. */
  openSlot(slot) {
    this.equipSlot = slot;
    this.listPage = 0;
    this.navigate('equip-slot');
  }

  /** Paginated list navigation (equip-slot / inventory-cat screens). */
  nextPage() {
    if (!['equip-slot', 'inventory-cat'].includes(this.currentId)) {
      this.term('no list to page through here', 'is-warn');
      return;
    }
    this.listPage = (this.listPage || 0) + 1; // buildScreen clamps to the last page
    this.render(false);
  }

  prevPage() {
    if (!['equip-slot', 'inventory-cat'].includes(this.currentId)) {
      this.term('no list to page through here', 'is-warn');
      return;
    }
    this.listPage = Math.max(0, (this.listPage || 0) - 1);
    this.render(false);
  }

  /** Equip an item (by uid) into the currently selected slot. */
  equipIntoSlot(uid) {
    const it = equipInSlotByUid(uid, this.equipSlot);
    if (!it) {
      this.term('item not found', 'is-error');
      return;
    }
    this.term(`equipped ${it.name} -> ${SLOT_LABELS[this.equipSlot]}`, 'is-ok');
  }

  /** Open an inventory category (filtered view). */
  openInvCat(cat) {
    this.invCat = cat;
    this.listPage = 0;
    this.navigate('inventory-cat');
  }

  /** `equip <name>` — equip the first inventory item matching the name. */
  equipByName(query) {
    if (!query) {
      this.term('usage: equip <item name>', 'is-warn');
      return;
    }
    const it = findEquippableByName(query);
    if (!it) {
      this.term(`no equippable item matching "${query}"`, 'is-error');
      return;
    }
    this.equipItem(it.uid);
  }

  /** `unequip <slot>` (or a menu action) — free a slot back to the inventory. */
  unequipSlot(slotInput) {
    const aliases = { w1: 'weapon1', w2: 'weapon2', weapon: 'weapon1', main: 'weapon1', off: 'weapon2', offhand: 'weapon2' };
    const slot = aliases[String(slotInput).toLowerCase()] || String(slotInput).toLowerCase();
    if (!EQUIP_SLOTS.includes(slot)) {
      this.term(`unknown slot. try: ${EQUIP_SLOTS.join(', ')}`, 'is-error');
      return;
    }
    const it = unequip(slot);
    this.term(it ? `unequipped ${it.name} (${SLOT_LABELS[slot]})` : `${SLOT_LABELS[slot]} is empty`, it ? 'is-ok' : 'is-warn');
  }

  /** `help items` — the modifier catalogue (stat, tiers, names). */
  itemsHelp() {
    this.term('items — rarity sets the number of name modifiers:', 'is-warn');
    this.term('  common: none · rare: 1 (prefix or suffix) · epic: 2 (both) · legendary: unique');
    this.term('modifier boost = stat perPoint x tier (shown in parentheses).');
    modifierHelpLines().forEach((l) => this.term(l));
  }

  /** Prefill the command line with an allocate command for a stat. */
  prefillAllocate(alias) {
    const cmd = `stats add ${alias} `;
    this.$input.value = cmd;
    this.term(`ready: ${cmd}<points>   (e.g. ${cmd}5)`, 'is-echo');
    if (!this.isTouch) this.$input.focus();
  }

  doExport() {
    const name = exportSave();
    this.term(`exported save: ${name}`, 'is-ok');
  }

  async doImport() {
    try {
      const { level } = await importSave();
      this.term(`save imported (level ${level})`, 'is-ok');
      this.render(false);
    } catch (err) {
      this.term(`import failed: ${err.message}`, 'is-error');
    }
  }

  confirmReset() {
    const ok = window.confirm('Reset your save? This erases all local progress.');
    if (ok) {
      resetSave();
      this.term('save reset', 'is-ok');
      this.goRoot();
    }
  }

  /** Set the colour theme by name, or report the valid options. */
  setTheme(name) {
    if (!THEMES.includes(name)) {
      this.term(`unknown theme: ${name}`, 'is-error');
      this.term(`available: ${THEMES.join(', ')}`, 'is-warn');
      return;
    }
    document.documentElement.dataset.theme = name;
    try {
      localStorage.setItem(THEME_KEY, name);
    } catch {
      /* ignore */
    }
    this.term(`theme set to ${name}`, 'is-ok');
  }

  /** Print how to use the theme command + the available colours. */
  themeUsage() {
    const current = document.documentElement.dataset.theme || THEMES[0];
    this.term('usage: theme <colour>   (e.g. theme blue)', 'is-warn');
    this.term(`available: ${THEMES.join(', ')}`);
    this.term(`current: ${current}`);
  }

  _applyStoredTheme() {
    let theme = THEMES[0];
    try {
      theme = localStorage.getItem(THEME_KEY) || THEMES[0];
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.theme = theme;
  }

  /** Enable/disable the menu transition animation (instant when disabled). */
  setAnimation(value) {
    let next;
    if (ANIM_ON.includes(value)) next = true;
    else if (ANIM_OFF.includes(value)) next = false;
    else {
      this.term('usage: animation <on|off>', 'is-error');
      return;
    }
    this.animEnabled = next;
    try {
      localStorage.setItem(ANIM_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.term(`menu animation ${next ? 'on' : 'off'}`, 'is-ok');
  }

  /** Print how to use the animation command + the current value. */
  animationUsage() {
    this.term('usage: animation <on|off>   (e.g. animation off)', 'is-warn');
    this.term(`current: ${this.animEnabled ? 'on' : 'off'}`);
  }

  _loadAnimation() {
    try {
      const v = localStorage.getItem(ANIM_KEY);
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  }

  /** Fit the UI to a phone (compact banner + phone-width column + stacked
   *  game windows), or restore the desktop layout. */
  setMobileView(value) {
    let next;
    if (ANIM_ON.includes(value)) next = true;
    else if (ANIM_OFF.includes(value)) next = false;
    else {
      this.term('usage: mobileview <on|off>', 'is-error');
      return;
    }
    this.mobileView = next;
    document.documentElement.dataset.mobile = next ? 'on' : 'off';
    try {
      localStorage.setItem(MOBILE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.windowManager.setMobile(next);
    this.term(`mobile view ${next ? 'on' : 'off'}`, 'is-ok');
    this.render(false);
  }

  /** Print how to use the mobileview command + the current value. */
  mobileViewUsage() {
    this.term('usage: mobileview <on|off>   (fits the UI to a phone)', 'is-warn');
    this.term(`current: ${this.mobileView ? 'on' : 'off'}`);
  }

  _loadMobileView() {
    try {
      const v = localStorage.getItem(MOBILE_KEY);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch {
      /* ignore */
    }
    return this.isTouch; // default: on for touch devices
  }

  // --- Pane heights (in lines) --------------------------------------------
  // NOTE: `termLines` is the transcript array; the line-count settings live on
  // `termRows` / `logRows` to avoid clobbering it.
  _loadLayout() {
    this.termRows = this._loadRows(TERMLINES_KEY, DEFAULT_TERMLINES);
    this.logRows = this._loadRows(LOGLINES_KEY, DEFAULT_LOGLINES);
    this._applyLayout();
  }

  _loadRows(key, def) {
    try {
      const v = parseInt(localStorage.getItem(key), 10);
      if (Number.isFinite(v)) return Math.min(MAX_LINES, Math.max(MIN_LINES, v));
    } catch {
      /* ignore */
    }
    return def;
  }

  _applyLayout() {
    const s = document.documentElement.style;
    s.setProperty('--term-lines', String(this.termRows));
    s.setProperty('--log-lines', String(this.logRows));
  }

  _parseRows(input) {
    const n = Math.trunc(Number(input));
    if (!Number.isFinite(n) || n < MIN_LINES || n > MAX_LINES) {
      this.term(`enter a line count between ${MIN_LINES} and ${MAX_LINES}`, 'is-error');
      return null;
    }
    return n;
  }

  setTermLines(input) {
    const n = this._parseRows(input);
    if (n == null) return;
    this.termRows = n;
    try {
      localStorage.setItem(TERMLINES_KEY, String(n));
    } catch {
      /* ignore */
    }
    this._applyLayout();
    this.term(`terminal height: ${n} lines`, 'is-ok');
  }

  setLogLines(input) {
    const n = this._parseRows(input);
    if (n == null) return;
    this.logRows = n;
    try {
      localStorage.setItem(LOGLINES_KEY, String(n));
    } catch {
      /* ignore */
    }
    this._applyLayout();
    this.term(`game log height: ${n} lines`, 'is-ok');
  }

  termLinesUsage() {
    this.term('usage: termlines <n>   (lines shown in the terminal)', 'is-warn');
    this.term(`current: ${this.termRows}  (default ${DEFAULT_TERMLINES})`);
  }

  logLinesUsage() {
    this.term('usage: loglines <n>   (lines shown in the game log)', 'is-warn');
    this.term(`current: ${this.logRows}  (default ${DEFAULT_LOGLINES})`);
  }

  async pingBackend() {
    const { apiBase } = getConfig();
    if (!apiBase) {
      this.term('no backend configured (offline)', 'is-warn');
      return;
    }
    this.term(`pinging ${apiBase}/health ...`);
    try {
      const res = await fetch(`${apiBase.replace(/\/$/, '')}/health`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        this.term(`backend online: ${data.status || 'ok'}`, 'is-ok');
      } else {
        this.term(`backend responded ${res.status}`, 'is-warn');
      }
    } catch (err) {
      this.term(`backend unreachable: ${err.message}`, 'is-error');
    }
  }
}

// "TERMINAL IDLE" — figlet "standard" font. String.raw keeps the backslashes.
const BANNER = String.raw`
 _____ _____ ____  __  __ ___ _   _    _    _       ___ ____  _     _____
|_   _| ____|  _ \|  \/  |_ _| \ | |  / \  | |     |_ _|  _ \| |   | ____|
  | | |  _| | |_) | |\/| || ||  \| | / _ \ | |      | || | | | |   |  _|
  | | | |___|  _ <| |  | || || |\  |/ ___ \| |___   | || |_| | |___| |___
  |_| |_____|_| \_\_|  |_|___|_| \_/_/   \_\_____| |___|____/|_____|_____|
`;
const BANNER_LINES = BANNER.split('\n').filter((l) => l.length > 0);

// A compact banner for mobile view — fits a phone width without scrolling.
const COMPACT_BANNER = String.raw`
.-----------------------.
|     TERMINAL IDLE     |
'-----------------------'
`;
const COMPACT_BANNER_LINES = COMPACT_BANNER.split('\n').filter((l) => l.length > 0);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
