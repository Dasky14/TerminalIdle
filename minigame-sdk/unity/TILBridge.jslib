// TILBridge.jslib — Unity WebGL <-> TerminalIdleProject shell bridge (outbound).
//
// Place this file under `Assets/Plugins/WebGL/` in your Unity project. It lets
// C# code post messages OUT to the shell using the same envelope the HTML SDK
// uses. Inbound messages (shell -> game) arrive via SendMessage to the
// "TILBridge" GameObject's OnShellMessage(string) — see TILBridge.cs.
//
// Exposed to C# via [DllImport("__Internal")]:
//   TIL_Post(string type, string payloadJson)

mergeInto(LibraryManager.library, {
  TIL_Post: function (typePtr, payloadPtr) {
    var type = UTF8ToString(typePtr);
    var payloadStr = UTF8ToString(payloadPtr);
    var payload = null;
    try {
      payload = payloadStr && payloadStr.length ? JSON.parse(payloadStr) : null;
    } catch (e) {
      payload = payloadStr; // fall back to raw string
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ __til: true, dir: 'out', type: type, payload: payload }, '*');
    }
  },
});
