import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  // The daemon only accepts its own Host and Origin; present both so a dev server on any port works.
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:47800', changeOrigin: true, headers: { origin: 'http://127.0.0.1:47800' } } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
