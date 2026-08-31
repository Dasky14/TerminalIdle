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
    id: 'sample-clicker',
    title: 'Sample Clicker',
    key: 'C',
    entry: 'minigames/sample-clicker/index.html',
    kind: 'html',
    size: { w: 420, h: 340 },
    desc: 'A tiny demo that grants XP and scrap — proves the reward loop.',
  },
];

/** Look up a minigame by id. */
export function getMinigame(id) {
  return MINIGAMES.find((m) => m.id === id);
}
