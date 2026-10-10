/**
 * eslint.config.js — flat ESLint config for the whole monorepo.
 *
 * Three blocks:
 *  1. Global ignores: build output (dist, dist-server), node_modules, generated
 *     API client, .d.ts files, source maps.
 *  2. Client block (client/** + shared/**): uses the fullstack-presets client
 *     rules, with tsconfig.app.json as the project, and import aliases
 *     (@ → ./client/src, @client → ./client, @shared → ./shared).
 *  3. Server block (server/** + shared/**): uses the fullstack-presets server
 *     rules, with tsconfig.node.json as the project, and import aliases
 *     (@server → ./server, @shared → ./shared).
 *
 * The shared/ directory is linted under both client and server configs so
 * cross-cutting types are checked consistently.
 */
const tseslint = require('typescript-eslint');
const { eslintPresetsOfSimple } = require('@lark-apaas/fullstack-presets');

module.exports = tseslint.config(
  {
    ignores: [
      'dist',
      'dist-server',
      'node_modules',
      'source_package',
      'client/src/api/gen',
      '**/*.d.ts',
      '**/*.js.map',
    ],
  },
  // Client configuration
  {
    files: ['client/**/*.{ts,tsx}', 'shared/**/*.{ts,tsx}'],
    extends: [
      ...eslintPresetsOfSimple.client,
    ],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.app.json',
      },
    },
    settings: {
      'import/resolver': {
        alias: {
          map: [
            ['@', './client/src'],
            ['@client', './client'],
            ['@shared', './shared'],
          ],
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    },
  },
  // Server configuration
  {
    files: ['server/**/*.{ts,tsx}', 'shared/**/*.{ts,tsx}'],
    extends: [
      ...eslintPresetsOfSimple.server,
    ],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.node.json',
      }
    },
    settings: {
      'import/resolver': {
        alias: {
          map: [['@server', './server'], ['@shared', './shared']],
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      }
    }
  },
);
