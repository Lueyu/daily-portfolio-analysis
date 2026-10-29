#!/usr/bin/env node
'use strict';

/**
 * Cross-environment replacement for the shell-only `prepare` script
 * (`chmod +x .githooks/pre-commit; git config core.hooksPath .githooks`).
 * Works on Windows (cmd), macOS and Linux, and never fails `npm install`:
 * if this is not a git clone or git is unavailable it simply skips.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const hookPath = path.join(repoRoot, '.githooks', 'pre-commit');

if (fs.existsSync(hookPath)) {
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // chmod is a no-op on some filesystems; git ignores the exec bit on Windows.
  }
}

try {
  execSync('git config core.hooksPath .githooks', { cwd: repoRoot, stdio: 'ignore' });
} catch {
  console.log('[setup-git-hooks] skipped (git unavailable or not a git clone).');
}
