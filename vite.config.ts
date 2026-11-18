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
        // The existing racing game stays at the site root.
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        // DEEP ATLAS lives under the games shelf: /games/deep-atlas/
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
