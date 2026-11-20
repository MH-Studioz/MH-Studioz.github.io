import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Relative base keeps every asset path working on GitHub Pages project sites
// and inside Electron's file/protocol loader.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: {
        // The site root is now a redirect to the games shelf.
        root: fileURLToPath(new URL('./index.html', import.meta.url)),
        // The shelf page that links both games: /games/
        gamesHub: fileURLToPath(new URL('./games/index.html', import.meta.url)),
        // The racing game lives under the games shelf: /games/apex-gp-2026/
        apex: fileURLToPath(new URL('./games/apex-gp-2026/index.html', import.meta.url)),
        // DEEP ATLAS lives next to it: /games/deep-atlas/
        deepAtlas: fileURLToPath(new URL('./games/deep-atlas/index.html', import.meta.url)),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
