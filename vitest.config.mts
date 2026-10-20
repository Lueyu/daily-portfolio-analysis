/**
 * @file vitest.config.ts
 * @description Vitest configuration for server/shared unit tests.
 *
 * Unit tests run in a Node environment (business logic, pure functions,
 * risk/rating rules). They are deliberately framework-agnostic and do not
 * bootstrap NestJS; logic that must be unit tested is extracted into pure
 * functions. Browser end-to-end tests live in Playwright (see
 * playwright.config.ts / e2e/).
 *
 * Path aliases mirror tsconfig.node.json and vite.config.ts:
 *   @server/* -> server/*
 *   @shared/* -> shared/*
 *   @         -> client/src
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@server': fileURLToPath(new URL('./server', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./client/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['server/**/*.spec.ts', 'shared/**/*.spec.ts'],
    watchExclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['server/modules/**/*.ts'],
      exclude: ['**/*.spec.ts', 'server/main.ts'],
    },
  },
});
