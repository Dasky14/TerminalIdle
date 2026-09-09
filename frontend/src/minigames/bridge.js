// The minigame <-> shell message bridge.
//
// One uniform postMessage contract is used for BOTH plain-HTML minigames and
// Unity WebGL builds, so the shell doesn't care which it launched.
//
// Envelope (both directions):
//   { __til: true, dir: 'out' | 'in', type: string, id?: string, payload?: any }
//     dir 'out' = minigame -> shell
//     dir 'in'  = shell -> minigame
//
// Shell -> minigame (dir:'in'):  init, pause, resume, shutdown
// Minigame -> shell (dir:'out'): ready, reward, progress, requestClose, error
//
// Security: each channel only accepts messages whose event.source is exactly the
// iframe's contentWindow, and ignores anything lacking the __til tag.

import { applyReward } from '../game/rewards.js';
import { state, emitChange, onChange } from '../game/state.js';
import { effectiveStats, activeEffects } from '../game/character.js';

const TAG = '__til';

// Idle / away-time tracking. The shell stamps a per-minigame `lastOpen` while a
// game is open (every HEARTBEAT_MS and on close) so that, on the next open, it
// can tell the game how long the player was away and let it bank offline
// progress. Away time is capped so a long absence can't produce absurd rewards.
const HEARTBEAT_MS = 15000; // worst-case progress lost if the tab is closed
const MAX_AWAY_MS = 24 * 60 * 60 * 1000; // 24h cap on banked idle time

/**
 * Create a bridge channel bound to one iframe.
 *
 * @param {object} opts
 * @param {HTMLIFrameElement} opts.iframe
 * @param {object} opts.minigame           the registry entry
 * @param {(unityInstance:any)=>void} [opts.onUnityInstance]  future hook
 * @param {(summary:object)=>void} [opts.onReward]   UI callback (e.g. toast)
 * @param {()=>void} [opts.onRequestClose]           minigame asked to close
 * @returns {{ send: Function, dispose: Function, setUnityInstance: Function }}
 */
export function createBridge({ iframe, minigame, onReward, onRequestClose }) {
  let unityInstance = null; // set by the loader page for Unity builds
  let disposed = false;
  let lastStatsJson = null; // dedup: only push stats when they actually change
  let heartbeat = null; // interval that keeps lastOpen fresh while open

  function isFromThisFrame(event) {
    return iframe && event.source === iframe.contentWindow;
  }

  /** This minigame's shell-owned metadata slice (created on demand). */
  function meta() {
    if (!state.minigameMeta) state.minigameMeta = {};
    if (!state.minigameMeta[minigame.id]) state.minigameMeta[minigame.id] = {};
    return state.minigameMeta[minigame.id];
  }

  /** Record "the game is open right now" and persist (via emitChange autosave). */
  function stampOpen() {
    meta().lastOpen = Date.now();
    emitChange();
  }

  /** Send a message INTO the minigame. Routes to Unity if an instance exists. */
  function send(type, payload) {
    const msg = { [TAG]: true, dir: 'in', type, payload };
    if (unityInstance && typeof unityInstance.SendMessage === 'function') {
      // Convention: Unity build has a GameObject "TILBridge" with a method
      // "OnShellMessage(string json)". See minigame-sdk/unity/TILBridge.cs.
      try {
        unityInstance.SendMessage('TILBridge', 'OnShellMessage', JSON.stringify(msg));
        return;
      } catch (err) {
        console.warn('[bridge] Unity SendMessage failed, falling back to postMessage:', err);
      }
    }
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(msg, '*');
    }
  }

  function handleMessage(event) {
    if (disposed || !isFromThisFrame(event)) return;
    const data = event.data;
    if (!data || data[TAG] !== true || data.dir !== 'out') return;

    switch (data.type) {
      case 'ready': {
        // Hand the minigame its context: player level, combat stats, active
        // item effects, its own saved slice, and how long it was away (capped)
        // so it can bank offline progress.
        const stats = effectiveStats();
        const effects = activeEffects();
        lastStatsJson = JSON.stringify({ stats, effects });
        const m = meta();
        const now = Date.now();
        const awayMs = m.lastOpen ? Math.min(Math.max(0, now - m.lastOpen), MAX_AWAY_MS) : 0;
        send('init', {
          minigameId: minigame.id,
          profile: { level: state.profile.level },
          stats,
          effects,
          save: state.minigames[minigame.id] || null,
          awayMs,
        });
        // Start the "open" clock and keep it ticking while the window lives.
        stampOpen();
        if (!heartbeat) heartbeat = setInterval(stampOpen, HEARTBEAT_MS);
        break;
      }
      case 'reward': {
        const summary = applyReward(data.payload || {}, { source: minigame.id });
        if (onReward) onReward(summary);
        break;
      }
      case 'progress': {
        // Persist a minigame-scoped save slice.
        state.minigames[minigame.id] = data.payload || {};
        emitChange();
        break;
      }
      case 'requestClose': {
        if (onRequestClose) onRequestClose();
        break;
      }
      case 'error': {
        console.error(`[minigame:${minigame.id}]`, data.payload);
        break;
      }
      default:
        console.warn('[bridge] Unknown message type from minigame:', data.type);
    }
  }

  window.addEventListener('message', handleMessage);

  // Push updated combat stats to the minigame whenever they change (e.g. the
  // player allocates points or changes gear). The minigame decides when to
  // apply them (the dungeon applies at the end of the current fight).
  const unsubStats = onChange(() => {
    if (disposed) return;
    const payload = { stats: effectiveStats(), effects: activeEffects() };
    const json = JSON.stringify(payload);
    if (json !== lastStatsJson) {
      lastStatsJson = json;
      send('stats', payload); // { stats, effects }
    }
  });

  return {
    send,
    /** Loader pages for Unity builds call this once the instance exists. */
    setUnityInstance(instance) {
      unityInstance = instance;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      stampOpen(); // final timestamp so away-time counts from the close
      if (unsubStats) unsubStats();
      try {
        send('shutdown');
      } catch {
        /* iframe may already be gone */
      }
      window.removeEventListener('message', handleMessage);
    },
  };
}
