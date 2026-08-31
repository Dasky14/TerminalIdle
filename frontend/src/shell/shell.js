// The menu-driven shell, styled as an authentic terminal.
//
// Terminal-first: the screen is drawn as printed output. Navigating clears the
// screen (like `clear`) and reprints every line one at a time, fast. Menu items
// are pure ASCII (`[S] Stats`); the selected one is marked with a `>` caret.
//
// Activation has three equivalent paths (handled here + input.js + mouse):
//   - press the item's letter               (hotkey)
//   - ArrowUp/ArrowDown to move, Enter       (keyboard focus)
//   - click the item                         (mouse)
// Esc / Backspace goes back.

import { buildScreen } from './menus.js';
import { onChange } from '../game/state.js';
import { getMinigame } from '../minigames/registry.js';
import { exportSave, importSave, resetSave } from '../game/save.js';
import { getConfig } from '../config.js';

const THEME_KEY = 'til.theme';
const THEMES = ['green', 'amber', 'blue', 'white'];
const MAX_LOG = 6;
const PRINT_DELAY_MS = 12; // per-line delay for the "printing" effect
const RULE = '-'.repeat(58);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Shell {
  /**
   * @param {HTMLElement} root
   * @param {import('../windows/windowManager.js').WindowManager} windowManager
   */
  constructor(root, windowManager) {
    this.root = root;
    this.windowManager = windowManager;
    this.stack = ['root'];
    this.focusIndex = 0;
    this.log = [];
    this.screen = null;
    this._renderGen = 0; // bumped on each render to cancel in-flight animations
    this._itemNodes = new Map();

    this._buildChrome();
    this._applyStoredTheme();

    // Live screens re-render instantly (no animation) when state changes.
    onChange(() => {
      if (['stats', 'inventory', 'resources', 'system'].includes(this.currentId)) {
        this.render(false);
      }
    });
  }

  get currentId() {
    return this.stack[this.stack.length - 1];
  }

  _buildChrome() {
    this.root.innerHTML = `
      <div class="term">
        <div class="term__out" tabindex="-1"></div>
        <div class="term__log" aria-live="polite"></div>
        <div class="term__cmdline">
          <span class="term__prompt">user@til:~$</span>
          <input class="term__input" type="text" spellcheck="false"
                 autocomplete="off" aria-label="command line" />
          <span class="term__blink" aria-hidden="true"></span>
        </div>
      </div>
    `;
    this.$out = this.root.querySelector('.term__out');
    this.$log = this.root.querySelector('.term__log');
    this.$input = this.root.querySelector('.term__input');
  }

  // --- Navigation ----------------------------------------------------------
  navigate(id) {
    this.stack.push(id);
    this.focusIndex = 0;
    this.render(true);
  }

  back() {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.focusIndex = 0;
      this.render(true);
    }
  }

  goRoot() {
    this.stack = ['root'];
    this.focusIndex = 0;
    this.render(true);
  }

  // --- Focus / activation --------------------------------------------------
  moveFocus(delta) {
    const n = this.screen.items.length;
    if (n === 0) return;
    this.focusIndex = (this.focusIndex + delta + n) % n;
    this._paintFocus();
  }

  activateFocused() {
    const item = this.screen.items[this.focusIndex];
    if (item) item.action(this);
  }

  activateByKey(letter) {
    const up = letter.toUpperCase();
    const item = this.screen.items.find((it) => (it.key || '').toUpperCase() === up);
    if (item) {
      item.action(this);
      return true;
    }
    return false;
  }

  // --- Rendering -----------------------------------------------------------
  /** @param {boolean} [animate=true] print line-by-line, or draw instantly. */
  async render(animate = true) {
    this.screen = buildScreen(this.currentId, this);
    if (this.focusIndex >= this.screen.items.length) this.focusIndex = 0;

    const lines = this._composeLines();
    const gen = ++this._renderGen;
    this.$out.innerHTML = '';
    this._itemNodes = new Map();

    if (!animate) {
      for (const entry of lines) this.$out.appendChild(this._makeNode(entry));
      this._paintFocus();
      return;
    }

    for (const entry of lines) {
      if (gen !== this._renderGen) return; // superseded by a newer render
      this.$out.appendChild(this._makeNode(entry));
      this.$out.scrollTop = this.$out.scrollHeight;
      // Blank/gap lines print instantly; content lines carry the delay.
      await sleep(entry.t === 'gap' ? 0 : PRINT_DELAY_MS);
    }
    if (gen !== this._renderGen) return;
    this._paintFocus();
  }

  /** Build the ordered list of line descriptors for the current screen. */
  _composeLines() {
    const s = this.screen;
    const lines = [];
    const cmd = this.currentId === 'root' ? 'menu' : this.currentId;
    lines.push({ t: 'prompt', text: `user@til:~$ ${cmd}` });

    if (this.currentId === 'root') {
      for (const bl of BANNER_LINES) lines.push({ t: 'banner', text: bl });
      lines.push({ t: 'dim', text: '        terminal idle :: a menu-driven game shell' });
    } else {
      lines.push({ t: 'head', text: `:: ${s.title}` });
    }
    lines.push({ t: 'rule', text: RULE });

    for (const b of s.body || []) lines.push({ t: 'text', text: b });
    if (s.body && s.body.length) lines.push({ t: 'gap', text: '' });

    s.items.forEach((it, i) =>
      lines.push({ t: 'item', index: i, key: it.key, label: it.label, hint: it.hint }),
    );

    lines.push({ t: 'gap', text: '' });
    lines.push({
      t: 'hint',
      text: '[letter] run  ·  up/down + enter  ·  esc back  ·  or click',
    });
    return lines;
  }

  _makeNode(entry) {
    const div = document.createElement('div');
    div.className = 'term__line';

    if (entry.t === 'item') {
      div.classList.add('term__line--item');
      div.dataset.index = String(entry.index);

      const caret = document.createElement('span');
      caret.className = 'term__caret';
      caret.textContent = '  ';

      const text = document.createElement('span');
      text.className = 'term__itext';
      text.textContent = `[${entry.key || '?'}] ${entry.label}`;

      div.append(caret, text);

      if (entry.hint) {
        const hint = document.createElement('span');
        hint.className = 'term__ihint';
        hint.textContent = `  - ${entry.hint}`;
        div.appendChild(hint);
      }

      div.addEventListener('click', () => {
        this.focusIndex = entry.index;
        this.activateFocused();
      });
      div.addEventListener('mousemove', () => {
        if (this.focusIndex !== entry.index) {
          this.focusIndex = entry.index;
          this._paintFocus();
        }
      });

      this._itemNodes.set(entry.index, { node: div, caret });
    } else {
      div.classList.add(`term__line--${entry.t}`);
      // Use a non-breaking-ish space so empty lines keep their height.
      div.textContent = entry.text === '' ? ' ' : entry.text;
    }
    return div;
  }

  _paintFocus() {
    for (const [index, { node, caret }] of this._itemNodes) {
      const selected = index === this.focusIndex;
      node.classList.toggle('is-selected', selected);
      caret.textContent = selected ? '> ' : '  ';
      if (selected) node.scrollIntoView({ block: 'nearest' });
    }
  }

  // --- Log (async/transient output) ---------------------------------------
  print(text, cls = '') {
    this.log.push({ text, cls });
    if (this.log.length > MAX_LOG) this.log.shift();
    this._renderLog();
  }

  _renderLog() {
    if (!this.$log) return;
    this.$log.innerHTML = this.log
      .map((l) => `<div class="term__logline ${l.cls}">${escapeHtml(l.text)}</div>`)
      .join('');
  }

  // --- Actions -------------------------------------------------------------
  openMinigame(id) {
    const mg = getMinigame(id);
    if (!mg) {
      this.print(`no such minigame: ${id}`, 'is-error');
      return;
    }
    this.windowManager.open(mg);
    this.print(`launched "${mg.title}"`, 'is-ok');
  }

  doExport() {
    const name = exportSave();
    this.print(`exported save: ${name}`, 'is-ok');
  }

  async doImport() {
    try {
      const { level } = await importSave();
      this.print(`save imported (level ${level})`, 'is-ok');
      this.render(false);
    } catch (err) {
      this.print(`import failed: ${err.message}`, 'is-error');
    }
  }

  confirmReset() {
    const ok = window.confirm('Reset your save? This erases all local progress.');
    if (ok) {
      resetSave();
      this.print('save reset', 'is-ok');
      this.goRoot();
    }
  }

  toggleTheme() {
    const current = document.documentElement.dataset.theme || THEMES[0];
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
    this.print(`theme: ${next}`, 'is-ok');
    if (this.currentId === 'system') this.render(false);
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

  async pingBackend() {
    const { apiBase } = getConfig();
    if (!apiBase) {
      this.print('no backend configured (offline)', 'is-warn');
      return;
    }
    this.print(`pinging ${apiBase}/health ...`);
    try {
      const res = await fetch(`${apiBase.replace(/\/$/, '')}/health`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        this.print(`backend online: ${data.status || 'ok'}`, 'is-ok');
      } else {
        this.print(`backend responded ${res.status}`, 'is-warn');
      }
    } catch (err) {
      this.print(`backend unreachable: ${err.message}`, 'is-error');
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
