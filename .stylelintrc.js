/**
 * @file .stylelintrc.js
 * @description Stylelint configuration. Standard ruleset with Tailwind v4
 * at-rules (@theme, @apply, @config, @plugin, @utility, @custom-variant)
 * and the intentional empty placeholder selectors used by the elevation
 * utilities whitelisted; ignores build output and generated artifacts.
 */
module.exports = {
  extends: ['stylelint-config-standard'],
  ignoreFiles: [
    'node_modules/**',
    'dist/**',
    'build/**',
    'coverage/**',
    'source_package/**',
    '*.min.css',
  ],
  rules: {
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'theme',
          'source',
          'utility',
          'variant',
          'custom-variant',
          'apply',
          'reference',
          'config',
          'plugin',
          'tailwind',
          'layer',
        ],
      },
    ],
    // Placeholder utilities keep empty rule blocks by design.
    'block-no-empty': null,
    // The elevation utilities intentionally repeat compound selectors.
    'no-duplicate-selectors': null,
    // `@apply hidden` is valid Tailwind v4 syntax.
    'at-rule-prelude-no-invalid': null,
  },
};
