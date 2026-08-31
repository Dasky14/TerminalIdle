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
import { onChange } from '../game/state.js';
import { getMinigame } from '../minigames/registry.js';
import { exportSave, importSave, resetSave } from '../game/save.js';
import { getConfig } from '../config.js';

const THEME_KEY = 'til.theme';
const THEMES = ['green', 'amber', 'blue', 'white'];
const ANIM_KEY = 'til.anim';
const MOBILE_KEY = 'til.mobile';
const ANIM_ON = ['on', 'enable', 'enabled', 'true', 'yes'];
const ANIM_OFF = ['off', 'disable', 'disabled', 'false', 'no'];
const PRINT_DELAY_MS = 12;
const RULE = '-'.repeat(58);
const MAX_TERM = 300;
const MAX_GAMELOG = 80;

// Top-level screens reachable by name from anywhere in the terminal.
const GLOBAL_SCREENS = ['stats', 'inventory', 'resources', 'games', 'system'];

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

    // Live screens (stats/inventory/...) redraw instantly when state changes.
    onChange(() => {
      if (['stats', 'inventory', 'resources', 'system'].includes(this.currentId)) {
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
