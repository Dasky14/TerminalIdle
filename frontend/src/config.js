// Runtime configuration.
//
// The backend address is read from /config.json AT RUNTIME (not baked into the
// bundle at build time). That means you can host the built static site anywhere
// (e.g. GitHub Pages) and later point it at a backend by editing a single file
// in the deployed output (`dist/config.json`) — no rebuild required.
//
// `apiBase: ""` (the default) means "no backend, play fully offline".

const DEFAULTS = {
  apiBase: '',
};

let cached = null;

/**
 * Load /config.json once and cache it. Always resolves (falls back to defaults
 * if the file is missing or malformed) so the game boots no matter what.
 * @returns {Promise<{apiBase: string}>}
 */
export async function loadConfig() {
  if (cached) return cached;
  try {
    // BASE_URL respects Vite's `base` so this works under a subpath deploy.
    const url = `${import.meta.env.BASE_URL}config.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`config.json HTTP ${res.status}`);
    const json = await res.json();
    cached = { ...DEFAULTS, ...json };
  } catch (err) {
    console.warn('[config] Falling back to defaults:', err.message);
    cached = { ...DEFAULTS };
  }
  return cached;
}

/** Synchronous access after loadConfig() has resolved. */
export function getConfig() {
  return cached || { ...DEFAULTS };
}
