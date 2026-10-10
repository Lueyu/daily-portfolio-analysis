/**
 * @file vite.config.ts
 * @description Vite build configuration (React + TypeScript preset).
 *
 * Configures the `@` -> `client/src` import alias used throughout the app.
 * Additional Lark aapaas preset defaults come from
 * `@lark-apaas/coding-preset-vite-react`.
 */
import path from 'path';
import { defineConfig } from '@lark-apaas/coding-preset-vite-react';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
});
