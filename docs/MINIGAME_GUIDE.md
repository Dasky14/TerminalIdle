# Authoring minigames

A minigame is any web content the shell loads into an `<iframe>`. It talks to the
shell through a small `postMessage` contract to grant rewards and save progress.
Two kinds are supported: **HTML/JS** and **Unity WebGL**. Both use the same
message contract.

## 1. Register the minigame

Add an entry to [`frontend/src/minigames/registry.js`](../frontend/src/minigames/registry.js):

```js
{
  id: 'my-game',                       // unique slug, used by `play my-game`
  title: 'My Game',
  key: 'M',                            // hotkey in the Games menu (optional)
  entry: 'minigames/my-game/index.html', // relative → served from public/; or a full URL
  kind: 'html',                        // 'html' | 'unity'
  size: { w: 480, h: 360 },
  desc: 'What it does.',
}
```

- **Bundled** games live in `frontend/public/minigames/<id>/` and use a relative
  `entry`. Everything in `public/` is copied to `dist/` as-is.
- **External** games can use a full `https://…` URL as `entry`.

## 2a. HTML minigame

Copy [`minigame-sdk/til-sdk.js`](../minigame-sdk/til-sdk.js) next to your
`index.html` and include it:

```html
<script src="til-sdk.js"></script>
<script>
  TIL.onInit((ctx) => {
    // ctx = { minigameId, profile: { level }, save: <your last slice | null> }
    if (ctx.save) restore(ctx.save);
  });

  // Grant global rewards whenever the player earns something:
  TIL.sendReward({ xp: 5, resources: { scrap: 1 }, items: [{ id: 'gear', name: 'Gear', qty: 1 }] });

  // Persist a minigame-scoped slice (returned in ctx.save next launch):
  TIL.saveProgress({ highScore: 123 });

  // Ask the shell to close this window:
  TIL.close();
</script>
```

`sample-clicker` is a complete working example — see
[`frontend/public/minigames/sample-clicker/`](../frontend/public/minigames/sample-clicker/).

### SDK reference

| Call                         | Effect                                                        |
| ---------------------------- | ------------------------------------------------------------- |
| `TIL.onInit(cb)`             | `cb(ctx)` when the shell sends context after your `ready`.    |
| `TIL.onMessage(cb)`          | `cb(type, payload)` for lifecycle msgs (`pause`/`resume`/…).  |
| `TIL.sendReward(reward)`     | Apply `{xp?, resources?, items?}` to global state.            |
| `TIL.saveProgress(slice)`    | Persist a per-minigame JSON slice.                            |
| `TIL.close()`                | Request the shell close the window.                           |
| `TIL.error(msg)`             | Log to the shell console.                                     |

## 2b. Unity WebGL minigame

1. Build your Unity project for **WebGL**.
2. Add the bridge files to your Unity project:
   - [`minigame-sdk/unity/TILBridge.jslib`](../minigame-sdk/unity/TILBridge.jslib)
     → `Assets/Plugins/WebGL/`
   - [`minigame-sdk/unity/TILBridge.cs`](../minigame-sdk/unity/TILBridge.cs)
     → attach to a GameObject named **exactly** `TILBridge` in your first scene.
3. From your game code:

   ```csharp
   // Grant rewards:
   TILBridge.Instance.SendReward(5, "scrap", 1);
   // or full control with a JSON string:
   TILBridge.Instance.SendRewardJson("{\"xp\":10,\"items\":[{\"id\":\"gear\",\"name\":\"Gear\",\"qty\":1}]}");

   // Persist progress:
   TILBridge.Instance.SaveProgress("{\"highScore\":123}");

   // React to shell context:
   TILBridge.Instance.OnInit += (json) => { /* parse init payload */ };
   ```

4. Host the Unity build output (the folder containing `index.html`) somewhere
   reachable, and point the registry `entry` at its `index.html` with
   `kind: 'unity'`.

### How inbound messages reach Unity

The shell keeps a handle to the Unity instance and delivers shell→game messages
via `unityInstance.SendMessage("TILBridge", "OnShellMessage", json)`. Unity's
default WebGL template exposes the instance as a global after
`createUnityInstance(...)` resolves. In your Unity `index.html` template, register
it so the shell can find it — e.g. assign the resolved instance to
`window.unityInstance` (a future shell hook can pick it up), or wire it through
your loader. Outbound game→shell messages always use `postMessage` from
`TILBridge.jslib` and work without any extra wiring.

> Note: the current bridge auto-wires the **outbound** path (rewards, progress,
> close) for Unity out of the box. If you need the shell to push `init`/`pause`
> into Unity, register the Unity instance with the window's bridge via
> `bridge.setUnityInstance(instance)` from your loader integration.

## Testing your minigame

1. `cd frontend && npm run dev`.
2. Navigate to **Games** and launch it (letter / arrows+Enter / click).
3. Trigger a reward and confirm the shell log shows `+XP` / resources, and that
   **Stats** / **Inventory** / **Resources** screens update.
4. Reload the page — persisted progress (`saveProgress`) should return via
   `onInit`'s `ctx.save`.
