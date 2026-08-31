import { defineConfig } from 'vite';

// Base is set to './' so the built site works when served from a subpath,
// e.g. a GitHub Pages project site (https://user.github.io/TerminalIdleProject/).
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
