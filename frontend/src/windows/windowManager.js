// Tracks open minigame windows, their bridges, and layout.
//
// Two layout modes:
//   - Desktop: free-floating, draggable/resizable windows (cascade placed).
//   - Mobile:  a full-screen, vertically-stacked overlay of full-width game
//              cards (no dragging). A top "‹ menu" button hides the overlay to
//              reach the terminal, and a floating "games (N)" button brings it
//              back — so multiple games can stay open and running at once.

import { FloatingWindow } from './window.js';
import { createBridge } from '../minigames/bridge.js';

const BASE_Z = 1000;

export class WindowManager {
  /**
   * @param {HTMLElement} root  container the windows are appended to (#windows)
   * @param {object} [hooks]
   * @param {(summary:object)=>void} [hooks.onReward]
   */
  constructor(root, hooks = {}) {
    this.root = root;
    this.hooks = hooks;
    this.windows = []; // { win, bridge, minigame }
    this.cascadeIndex = 0;

    this.mobile = false;
    this._overlayHidden = false;
    this.bar = null; // mobile top bar element
    this.fab = null; // mobile "games (N)" floating button
  }

  _resolveEntry(entry) {
    if (/^https?:\/\//i.test(entry)) return entry;
    const base = import.meta.env.BASE_URL || '/';
    return `${base}${entry.replace(/^\//, '')}`;
  }

  /**
   * Open a minigame window. If it's already open, surface it.
   * @param {object} minigame  a registry entry
   */
  open(minigame) {
    const existing = this.windows.find((w) => w.minigame.id === minigame.id);
    if (existing) {
      if (this.mobile) {
        this._overlayHidden = false;
        this._updateMobileUI();
      } else {
        this.focus(existing.win);
      }
      return existing.win;
    }

    const offset = 28 * (this.cascadeIndex++ % 6);
    const win = new FloatingWindow({
      title: minigame.title,
      src: this._resolveEntry(minigame.entry),
      size: minigame.size || { w: 480, h: 360 },
      position: { x: 80 + offset, y: 60 + offset },
      onFocus: (w) => this.focus(w),
      onClose: (w) => this.close(w),
    });

    this.root.appendChild(win.el);

    const bridge = createBridge({
      iframe: win.iframe,
      minigame,
      onReward: this.hooks.onReward,
      onRequestClose: () => win.close(),
    });

    this.windows.push({ win, bridge, minigame });
    win.applyMobile(this.mobile);

    if (this.mobile) {
      this._overlayHidden = false;
      this._updateMobileUI();
    } else {
      this.focus(win);
    }
    return win;
  }

  /** Bring a window to the front (desktop only). */
  focus(win) {
    if (this.mobile) return;
    const idx = this.windows.findIndex((w) => w.win === win);
    if (idx !== -1) {
      const [entry] = this.windows.splice(idx, 1);
      this.windows.push(entry);
    }
    this.windows.forEach((w, i) => {
      w.win.setZIndex(BASE_Z + i);
      w.win.setActive(w.win === win);
    });
  }

  /** Close a window and dispose its bridge. */
  close(win) {
    const idx = this.windows.findIndex((w) => w.win === win);
    if (idx === -1) return;
    const [entry] = this.windows.splice(idx, 1);
    entry.bridge.dispose();

    if (this.mobile) {
      this._updateMobileUI();
    } else {
      const top = this.windows[this.windows.length - 1];
      if (top) top.win.setActive(true);
    }
  }

  get count() {
    return this.windows.length;
  }

  // --- Mobile mode ---------------------------------------------------------
  /** Switch between desktop (floating) and mobile (stacked overlay) layouts. */
  setMobile(on) {
    if (this.mobile === on) return;
    this.mobile = on;
    this.root.classList.toggle('mobile', on);

    if (on) {
      this._ensureMobileChrome();
      for (const w of this.windows) w.win.applyMobile(true);
      this._overlayHidden = false;
      this._updateMobileUI();
    } else {
      for (const w of this.windows) w.win.applyMobile(false);
      this._removeMobileChrome();
      // Restore desktop z-order / active state.
      this.windows.forEach((w, i) => w.win.setZIndex(BASE_Z + i));
      const top = this.windows[this.windows.length - 1];
      if (top) top.win.setActive(true);
    }
  }

  hideOverlay() {
    this._overlayHidden = true;
    this._updateMobileUI();
  }

  showOverlay() {
    this._overlayHidden = false;
    this._updateMobileUI();
  }

  _ensureMobileChrome() {
    if (!this.bar) {
      this.bar = document.createElement('div');
      this.bar.className = 'mobile-bar';
      const menuBtn = document.createElement('button');
      menuBtn.className = 'mobile-bar__menu';
      menuBtn.textContent = '‹ menu';
      menuBtn.addEventListener('click', () => this.hideOverlay());
      const title = document.createElement('span');
      title.className = 'mobile-bar__title';
      title.textContent = 'open games';
      this.bar.append(menuBtn, title);
    }
    if (this.bar.parentNode !== this.root) {
      this.root.insertBefore(this.bar, this.root.firstChild);
    }
    if (!this.fab) {
      this.fab = document.createElement('button');
      this.fab.className = 'games-fab';
      this.fab.addEventListener('click', () => this.showOverlay());
      document.body.appendChild(this.fab);
    }
  }

  _removeMobileChrome() {
    if (this.bar && this.bar.parentNode) this.bar.parentNode.removeChild(this.bar);
    if (this.fab && this.fab.parentNode) this.fab.parentNode.removeChild(this.fab);
    this.bar = null;
    this.fab = null;
    this.root.classList.remove('shown');
  }

  _updateMobileUI() {
    if (!this.mobile) return;
    const n = this.windows.length;
    const overlayVisible = n > 0 && !this._overlayHidden;
    this.root.classList.toggle('shown', overlayVisible);
    if (this.fab) {
      this.fab.classList.toggle('shown', this.mobile && n > 0 && !overlayVisible);
      this.fab.textContent = `games (${n})`;
    }
  }
}
