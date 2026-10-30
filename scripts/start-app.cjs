const { ensureSettingsKey } = require('./ensure-settings-key.cjs');

process.umask(0o077);
try {
  process.env.SETTINGS_ENCRYPTION_KEY = ensureSettingsKey(
    process.env.SETTINGS_ENCRYPTION_KEY,
    '/app/.secrets/settings.key',
  );
} catch (error) {
  process.stderr.write(`Cannot start Squabble: ${error.message}\n`);
  process.exit(1);
}

require('../dist/server/main.js');
