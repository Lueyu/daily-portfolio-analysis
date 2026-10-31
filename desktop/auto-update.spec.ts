import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAutomaticUpdateSupported } from './auto-update.mts';

test('automatic installation is limited to packaged Windows x64 builds', () => {
  assert.equal(isAutomaticUpdateSupported('win32', 'x64', true), true);
  assert.equal(isAutomaticUpdateSupported('win32', 'arm64', true), false);
  assert.equal(isAutomaticUpdateSupported('darwin', 'x64', true), false);
  assert.equal(isAutomaticUpdateSupported('win32', 'x64', false), false);
});
