/*
 * TIL SDK — drop-in bridge for HTML minigames.
 *
 * Copy this file next to your minigame's index.html and include it:
 *     <script src="til-sdk.js"></script>
 * Then use the global `TIL`:
 *
 *     TIL.onInit((ctx) => {
 *       // ctx = { minigameId, profile:{level}, save:<your last saved slice|null> }
 *       console.log('player level', ctx.profile.level);
 *     });
 *     TIL.sendReward({ xp: 5, resources: { scrap: 1 }, items: [{id:'gear', name:'Gear', qty:1}] });
 *     TIL.saveProgress({ highScore: 123 });   // persisted by the shell, returned in ctx.save next time
 *     TIL.close();                             // ask the shell to close this window
 *
 * The shell hosts the game in an <iframe>; all communication is postMessage.
 * The same message contract is used by Unity WebGL builds (see unity/).
 */
(function (global) {
  var TAG = '__til';
  var initCbs = [];
  var messageCbs = [];

  function post(type, payload) {
    if (global.parent && global.parent !== global) {
      global.parent.postMessage({ __til: true, dir: 'out', type: type, payload: payload }, '*');
    }
  }

  global.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data[TAG] !== true || data.dir !== 'in') return;
    if (data.type === 'init') {
      initCbs.forEach(function (cb) {
        try {
          cb(data.payload || {});
        } catch (e) {
          post('error', String(e && e.message ? e.message : e));
        }
      });
    }
    messageCbs.forEach(function (cb) {
      try {
        cb(data.type, data.payload);
      } catch (e) {
        /* ignore */
      }
    });
  });

  var TIL = {
    /** Register a callback for the shell's init context. */
    onInit: function (cb) {
      initCbs.push(cb);
    },
    /** Register a low-level handler for any shell->game message (pause/resume/shutdown). */
    onMessage: function (cb) {
      messageCbs.push(cb);
    },
    /** Grant global rewards: { xp?, resources?:{name:amount}, items?:[{id,name,qty}] }. */
    sendReward: function (reward) {
      post('reward', reward || {});
    },
    /** Persist a minigame-scoped save slice (any JSON-serializable object). */
    saveProgress: function (slice) {
      post('progress', slice || {});
    },
    /** Ask the shell to close this minigame's window. */
    close: function () {
      post('requestClose');
    },
    /** Report an error to the shell console. */
    error: function (msg) {
      post('error', msg);
    },
  };

  // Announce readiness so the shell replies with `init`.
  function announce() {
    post('ready');
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    announce();
  } else {
    document.addEventListener('DOMContentLoaded', announce);
  }

  global.TIL = TIL;
})(window);
