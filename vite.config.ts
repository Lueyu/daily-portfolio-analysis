/**
 * @file vite.config.ts
 * @description Vite build configuration (React + TypeScript).
 *
 * Standard config since the de-platforming: the client app lives under
 * `client/` (vite root), builds into `dist/client` (where the Nest server
 * serves the SPA from), and dev proxies /api to the NestJS backend on :3000.
 * The router basename reads `import.meta.env.BASE_URL` (vite `base`, "/").
 */
import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
});
