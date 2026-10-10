/**
 * @file .stylelintrc.js
 * @description Stylelint configuration using the shared Lark aapaas "simple"
 * preset. Ignores build output, minified CSS, and generated artifacts.
 */
const { stylelintPresetsOfSimple } = require('@lark-apaas/fullstack-presets');

module.exports = {
  extends: [ stylelintPresetsOfSimple ],
  ignoreFiles: [
    'node_modules/**',
    'dist/**',
    'build/**',
    'coverage/**',
    'source_package/**',
    '*.min.css',
  ],
};
