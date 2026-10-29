#!/usr/bin/env node
'use strict';

/**
 * Cross-environment postinstall hook.
 *
 * The original template ran `fullstack-cli action-plugin init` here, but that
 * CLI only exists inside the Miaoda (aPaaS) sandbox. Running it unconditionally
 * makes `npm install` fail for everyone outside the platform. This wrapper
 * executes the init only when the CLI is actually available and silently skips
 * otherwise.
 */
const { execSync } = require('child_process');

try {
  execSync('fullstack-cli action-plugin init', { stdio: 'inherit' });
} catch {
  console.log(
    '[postinstall] fullstack-cli not available - skipping platform plugin init ' +
      '(expected outside the Miaoda platform; the app runs fine without it).',
  );
}
