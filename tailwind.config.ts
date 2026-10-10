/**
 * @file tailwind.config.ts
 * @description Tailwind CSS configuration.
 *
 * Uses the shared Lark aapaas "simple" preset and scans all source files under
 * `client/src` for utility classes. Theme extensions (success/warning/destructive
 * tokens, font-serif / font-mono-nums families) live in the preset.
 */
import { createTailwindPresetOfSimple } from '@lark-apaas/fullstack-presets';

export default {
  presets: [createTailwindPresetOfSimple()],
  content: [
    './client/src/**/*.{ts,tsx,css}',
  ],
  plugins: [],
}