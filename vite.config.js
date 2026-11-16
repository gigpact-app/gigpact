import { defineConfig } from 'vite';
export default defineConfig({
  root: 'web',
  base: './',
  build: { outDir: '../dist', emptyOutDir: false, target: 'es2022', chunkSizeWarningLimit: 2500 },
  server: { host: '127.0.0.1', port: 5173 },
});
