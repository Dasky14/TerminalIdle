// The catalogue of available minigames.
//
// Each entry:
//   id     unique slug, used by `play <id>` and as the save-slice key
//   title  human label shown in the Games menu
//   key    single-letter hotkey for the Games menu (optional; auto-assigned if omitted)
//   entry  URL loaded into the window's <iframe>. Relative paths resolve against
//          the deployed base, so bundled games live under public/minigames/...
//   kind   'html' (plain web content) or 'unity' (a Unity WebGL build)
//   size   initial window size { w, h } in px
//   desc   one-line description
//
// To add a minigame: build it as web content (or a Unity WebGL build), drop it
// somewhere reachable (public/minigames/<id>/ for bundled games, or any URL),
// and add an entry here. See docs/MINIGAME_GUIDE.md.

export const MINIGAMES = [
  {
    id: 'dungeon',
    title: 'Endless Dungeon',
    key: 'D',
    entry: 'minigames/dungeon/index.html',
    kind: 'html',
    size: { w: 540, h: 480 },
    desc: 'Auto-battle deeper each floor. Enemies drop gear and XP; die and you restart the floor.',
  },
];

/** Look up a minigame by id. */
export function getMinigame(id) {
  return MINIGAMES.find((m) => m.id === id);
}
