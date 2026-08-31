// TILBridge.cs — Unity-side helper for talking to the TerminalIdleProject shell.
//
// Setup:
//   1. Put TILBridge.jslib in Assets/Plugins/WebGL/.
//   2. Add this script to a GameObject named EXACTLY "TILBridge" in your first
//      scene (the shell calls SendMessage("TILBridge", "OnShellMessage", json)).
//   3. From anywhere, call TILBridge.Instance.SendReward(...) etc.
//
// The message contract matches the HTML SDK:
//   OUT (game -> shell): ready, reward, progress, requestClose, error
//   IN  (shell -> game): init, pause, resume, shutdown
//
// Rewards/progress payloads are sent as JSON strings. Keep them simple; Unity's
// JsonUtility is used here to avoid extra dependencies.

using System;
using System.Runtime.InteropServices;
using UnityEngine;

public class TILBridge : MonoBehaviour
{
    public static TILBridge Instance { get; private set; }

    // Fired when the shell sends its init context (raw JSON string).
    public event Action<string> OnInit;
    public event Action OnPause;
    public event Action OnResume;
    public event Action OnShutdown;

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern void TIL_Post(string type, string payloadJson);
#else
    // Editor / non-WebGL fallback so the project still runs in the editor.
    private static void TIL_Post(string type, string payloadJson)
    {
        Debug.Log($"[TILBridge:editor] {type} {payloadJson}");
    }
#endif

    private void Awake()
    {
        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    private void Start()
    {
        // Announce readiness; the shell replies with an `init` message.
        TIL_Post("ready", "");
    }

    // ---- Outbound (call these from your game) -------------------------------

    /// <summary>Grant global rewards. Pass a JSON string for full control, e.g.
    /// {"xp":5,"resources":{"scrap":1},"items":[{"id":"gear","name":"Gear","qty":1}]}.</summary>
    public void SendRewardJson(string rewardJson)
    {
        TIL_Post("reward", rewardJson);
    }

    /// <summary>Convenience: grant a flat XP + single resource reward.</summary>
    public void SendReward(int xp, string resourceName = null, int resourceAmount = 0)
    {
        string res = string.IsNullOrEmpty(resourceName)
            ? ""
            : $",\"resources\":{{\"{resourceName}\":{resourceAmount}}}";
        SendRewardJson($"{{\"xp\":{xp}{res}}}");
    }

    /// <summary>Persist a minigame-scoped save slice (JSON string).</summary>
    public void SaveProgress(string sliceJson)
    {
        TIL_Post("progress", sliceJson);
    }

    /// <summary>Ask the shell to close this window.</summary>
    public void Close()
    {
        TIL_Post("requestClose", "");
    }

    public void ReportError(string message)
    {
        TIL_Post("error", $"\"{message}\"");
    }

    // ---- Inbound (called by the shell via SendMessage) ----------------------

    // The shell calls: unityInstance.SendMessage("TILBridge", "OnShellMessage", json)
    public void OnShellMessage(string json)
    {
        // json looks like {"__til":true,"dir":"in","type":"init","payload":{...}}
        var envelope = JsonUtility.FromJson<Envelope>(json);
        switch (envelope.type)
        {
            case "init":
                OnInit?.Invoke(json); // hand the raw JSON so you can parse payload as you like
                break;
            case "pause":
                OnPause?.Invoke();
                break;
            case "resume":
                OnResume?.Invoke();
                break;
            case "shutdown":
                OnShutdown?.Invoke();
                break;
        }
    }

    [Serializable]
    private struct Envelope
    {
        public bool __til;
        public string dir;
        public string type;
    }
}
