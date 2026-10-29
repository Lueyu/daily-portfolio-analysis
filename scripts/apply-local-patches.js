#!/usr/bin/env node
'use strict';

/**
 * Re-applies the repository's cross-environment fixes after a
 * Miaoda -> GitHub sync overwrites cloud-owned files
 * (see scripts/sync-from-miaoda.ps1, step 4.1).
 *
 * Each patch targets the exact platform-template pattern; if the upstream
 * template changes so the pattern no longer matches, the patch silently
 * no-ops (the synced file then keeps whatever the cloud ships).
 *
 * Patches:
 *  1. package.json  - postinstall/prepare must not call fullstack-cli / bash
 *                     only syntax: both break `npm install` off-platform.
 *  2. scripts/lint.js - spawning .cmd without a shell throws EINVAL on
 *                     Node >= 20.12.2 (CVE-2024-27980); run one command line.
 *  3. scripts/hooks/run-precommit.js - same Windows spawn fix for the
 *                     pre-commit hook.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const patches = [
  {
    file: 'package.json',
    note: 'postinstall/prepare -> cross-platform node scripts',
    replacements: [
      [/("postinstall"\s*:\s*)"[^"]*fullstack-cli[^"]*"/, '$1"node scripts/postinstall.js"'],
      [/("prepare"\s*:\s*)"chmod[^"]*"/, '$1"node scripts/setup-git-hooks.js"'],
    ],
  },
  {
    file: 'scripts/lint.js',
    note: 'lint.js spawn argv -> single shell command line (Windows EINVAL)',
    replacements: [
      [
        /spawn\(command,\s*args,\s*\{\s*cwd,\s*stdio:\s*'inherit',\s*shell:\s*false,\s*\}\)/,
        "spawn([command, ...args].join(' '), {\n      cwd,\n      stdio: 'inherit',\n      shell: true,\n    })",
      ],
    ],
  },
  {
    file: 'scripts/hooks/run-precommit.js',
    note: "run-precommit.js spawnSync('npm', argv) -> shell string",
    replacements: [
      [
        /spawnSync\('npm',\s*\[\s*'run',\s*'lint'\s*\],\s*\{\s*cwd,\s*stdio:\s*\['ignore',\s*'pipe',\s*'pipe'\],\s*env:\s*process\.env,\s*\}\)/,
        "spawnSync('npm run lint', {\n    cwd,\n    stdio: ['ignore', 'pipe', 'pipe'],\n    env: process.env,\n    shell: true,\n  })",
      ],
    ],
  },
  {
    file: 'server/common/middleware/local-dev-auth.middleware.ts',
    note: 'local-dev-auth: also mark requests as custom-host so the SPA basename resolves to "/"',
    replacements: [
      [
        /req\.headers\['x-larkgw-suda-webuser'\] = encodeURIComponent\(\s*JSON\.stringify\(webuser\),\s*\);(\s*)next\(\);/,
        "req.headers['x-larkgw-suda-webuser'] = encodeURIComponent(\n    JSON.stringify(webuser),\n  );$1// Local/offline mode implies a custom (non-platform) host: the platform\n$1// view-context middleware then resolves the SPA basename to \"/\" instead of\n$1// the platform prefix /app/<appId> (resolveBasename in the platform core).\n$1if (req.headers['x-miaoda-custom-host'] === undefined) {\n$1  req.headers['x-miaoda-custom-host'] = 'local-dev';\n$1}\n$1next();",
      ],
    ],
  },
];

let applied = 0;
for (const patch of patches) {
  const file = path.join(ROOT, patch.file);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  let content = before;
  for (const [pattern, replacement] of patch.replacements) {
    content = content.replace(pattern, replacement);
  }
  if (content !== before) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`[patch] ${patch.file}: ${patch.note}`);
    applied += 1;
  }
}
if (applied === 0) console.log('[patch] nothing to apply (files already patched or patterns changed)');
