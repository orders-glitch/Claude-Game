import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (GitHub Pages project sites, itch.io, etc.)
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
  server: { host: true },
});
