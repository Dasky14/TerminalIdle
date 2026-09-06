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

  function isFromThisFrame(event) {
    return iframe && event.source === iframe.contentWindow;
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
        // item effects, and its own saved slice.
        const stats = effectiveStats();
        const effects = activeEffects();
        lastStatsJson = JSON.stringify({ stats, effects });
        send('init', {
          minigameId: minigame.id,
          profile: { level: state.profile.level },
          stats,
          effects,
          save: state.minigames[minigame.id] || null,
        });
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
