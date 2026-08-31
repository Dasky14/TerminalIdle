// The menu-driven shell: renders the current screen and coordinates navigation.
//
// The shell is terminal-styled but MENU-FIRST. Every screen is a list of
// hotkey-labeled items that can be activated three equivalent ways:
//   - press the item's letter               (hotkey)
//   - ArrowUp/ArrowDown to move, Enter       (keyboard focus)
//   - click the item                         (mouse)
// Esc / Backspace goes back. A typed command line handles power actions.
//
// Keyboard wiring lives in input.js; the command line in commandLine.js.

import { buildScreen } from './menus.js';
import { onChange } from '../game/state.js';
import { getMinigame } from '../minigames/registry.js';
import { exportSave, importSave, resetSave } from '../game/save.js';
import { getConfig } from '../config.js';

const THEME_KEY = 'til.theme';
const THEMES = ['green', 'amber', 'blue'];
const MAX_LOG = 8;

export class Shell {
  /**
   * @param {HTMLElement} root         where the terminal renders (#screen)
   * @param {import('../windows/windowManager.js').WindowManager} windowManager
   */
  constructor(root, windowManager) {
    this.root = root;
    this.windowManager = windowManager;
    this.stack = ['root']; // menu navigation stack (screen ids)
    this.focusIndex = 0;
    this.log = [];
    this.screen = null; // current built screen descriptor

    this._buildChrome();
    this._applyStoredTheme();

    // Re-render live screens (stats/inventory/resources) when state changes.
    onChange(() => {
      if (['stats', 'inventory', 'resources', 'system'].includes(this.currentId)) {
        this.render();
      }
    });
  }

  get currentId() {
    return this.stack[this.stack.length - 1];
  }

  // --- DOM chrome (built once) ---------------------------------------------
  _buildChrome() {
    this.root.innerHTML = `
      <div class="term">
        <pre class="term__banner"></pre>
        <div class="term__screen"></div>
        <div class="term__log" aria-live="polite"></div>
        <div class="term__cmdline">
          <span class="term__prompt">user@til:~$</span>
          <input class="term__input" type="text" spellcheck="false"
                 autocomplete="off" aria-label="command line"
                 placeholder="type a command (help) — or just use the menu" />
        </div>
      </div>
    `;
    this.$screen = this.root.querySelector('.term__screen');
    this.$log = this.root.querySelector('.term__log');
    this.$input = this.root.querySelector('.term__input');
    this.root.querySelector('.term__banner').textContent = BANNER;
  }

  // --- Navigation ----------------------------------------------------------
  navigate(id) {
    this.stack.push(id);
    this.focusIndex = 0;
    this.render();
  }

  back() {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.focusIndex = 0;
      this.render();
    }
  }

  goRoot() {
    this.stack = ['root'];
    this.focusIndex = 0;
    this.render();
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

  /** Activate an item by its hotkey letter. Returns true if one matched. */
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
  render() {
    this.screen = buildScreen(this.currentId, this);
    if (this.focusIndex >= this.screen.items.length) this.focusIndex = 0;

    const bodyHtml = (this.screen.body || [])
      .map((line) => `<div class="term__bodyline">${escapeHtml(line)}</div>`)
      .join('');

    const itemsHtml = this.screen.items
      .map((it, i) => {
        const hint = it.hint ? `<span class="term__hint"> — ${escapeHtml(it.hint)}</span>` : '';
        return `<li class="term__item" data-index="${i}" tabindex="0">
            <span class="term__key">${escapeHtml(it.key || '·')}</span><span class="term__sep">:</span>
            <span class="term__label">${escapeHtml(it.label)}</span>${hint}
          </li>`;
      })
      .join('');

    const crumbs = this.stack.join(' / ');
    this.$screen.innerHTML = `
      <div class="term__crumbs">~/${escapeHtml(crumbs)}</div>
      <div class="term__title">${escapeHtml(this.screen.title)}</div>
      ${bodyHtml ? `<div class="term__body">${bodyHtml}</div>` : ''}
      <ul class="term__items">${itemsHtml}</ul>
      <div class="term__help">↑/↓ move · Enter select · Esc back · or press a letter · or click</div>
    `;

    // Wire mouse: click activates, hover focuses.
    this.$screen.querySelectorAll('.term__item').forEach((li) => {
      const idx = Number(li.dataset.index);
      li.addEventListener('click', () => {
        this.focusIndex = idx;
        this.activateFocused();
      });
      li.addEventListener('mousemove', () => {
        if (this.focusIndex !== idx) {
          this.focusIndex = idx;
          this._paintFocus();
        }
      });
    });

    this._paintFocus();
    this._renderLog();
  }

  _paintFocus() {
    this.$screen.querySelectorAll('.term__item').forEach((li) => {
      li.classList.toggle('term__item--active', Number(li.dataset.index) === this.focusIndex);
    });
  }

  // --- Log (transient output) ---------------------------------------------
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

  // --- Actions used by menu items / command line ---------------------------
  openMinigame(id) {
    const mg = getMinigame(id);
    if (!mg) {
      this.print(`No such minigame: ${id}`, 'is-error');
      return;
    }
    this.windowManager.open(mg);
    this.print(`Launched "${mg.title}".`, 'is-ok');
  }

  doExport() {
    const name = exportSave();
    this.print(`Exported save: ${name}`, 'is-ok');
  }

  async doImport() {
    try {
      const { level } = await importSave();
      this.print(`Save imported (level ${level}).`, 'is-ok');
      this.render();
    } catch (err) {
      this.print(`Import failed: ${err.message}`, 'is-error');
    }
  }

  confirmReset() {
    const ok = window.confirm('Reset your save? This erases all local progress.');
    if (ok) {
      resetSave();
      this.print('Save reset.', 'is-ok');
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
    this.print(`Theme: ${next}`, 'is-ok');
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
      this.print('No backend configured (apiBase is empty). Playing offline.', 'is-warn');
      return;
    }
    this.print(`Pinging ${apiBase}/health ...`);
    try {
      const res = await fetch(`${apiBase.replace(/\/$/, '')}/health`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        this.print(`Backend online: ${data.status || 'ok'}`, 'is-ok');
      } else {
        this.print(`Backend responded ${res.status}.`, 'is-warn');
      }
    } catch (err) {
      this.print(`Backend unreachable: ${err.message}`, 'is-error');
    }
  }
}

const BANNER = String.raw`
 _____                   _             _   ___    _ _
|_   _|__ _ _ _ __ ___ (_)_ _  __ _| | |_ _|__| | |___
  | |/ -_) '_| '  \/ -_)| | ' \/ _` + '`' + ` | |  | |/ _` + '`' + ` | / -_)
  |_|\___|_| |_|_|_\___||_|_||_\__,_|_| |___\__,_|_\___|
        terminal idle // menu-driven game shell
`;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
