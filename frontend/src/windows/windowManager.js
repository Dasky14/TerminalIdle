// Tracks open floating windows: creation, focus/z-order, cascade placement, and
// tearing down each window's minigame bridge on close.

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
  }

  /** Resolve a minigame `entry` against the deployed base URL. */
  _resolveEntry(entry) {
    if (/^https?:\/\//i.test(entry)) return entry;
    const base = import.meta.env.BASE_URL || '/';
    return `${base}${entry.replace(/^\//, '')}`;
  }

  /**
   * Open a minigame in a new floating window. If it's already open, focus it.
   * @param {object} minigame  a registry entry
   * @returns {FloatingWindow}
   */
  open(minigame) {
    const existing = this.windows.find((w) => w.minigame.id === minigame.id);
    if (existing) {
      this.focus(existing.win);
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
    this.focus(win);
    return win;
  }

  /** Bring a window to the front and mark it active. */
  focus(win) {
    // Move to end (top) of the stack.
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
    // Re-mark the new topmost window active.
    const top = this.windows[this.windows.length - 1];
    if (top) top.win.setActive(true);
  }

  /** Number of currently open windows. */
  get count() {
    return this.windows.length;
  }
}
