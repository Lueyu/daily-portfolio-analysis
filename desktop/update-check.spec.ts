import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkForUpdate, isNewerVersion } from './update-check.mts';

const release = {
  tag_name: 'v2.2.0',
  html_url: 'https://github.com/Lueyu/squabble/releases/tag/v2.2.0',
  body: 'Changes in this release',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'Squabble-2.2.0-win-x64-Setup.exe', browser_download_url: 'https://github.com/Lueyu/squabble/releases/download/v2.2.0/Squabble-2.2.0-win-x64-Setup.exe' },
    { name: 'Squabble-2.2.0-mac-arm64.dmg', browser_download_url: 'https://github.com/Lueyu/squabble/releases/download/v2.2.0/Squabble-2.2.0-mac-arm64.dmg' },
  ],
};

function reply(value: unknown): typeof fetch {
  return (async () => ({ ok: true, json: async () => value })) as unknown as typeof fetch;
}

test('version comparison ignores older, equal and malformed tags', () => {
  assert.equal(isNewerVersion('v2.2.0', '2.1.9'), true);
  assert.equal(isNewerVersion('v2.1.0', '2.1.0'), false);
  assert.equal(isNewerVersion('v2.0.9', '2.1.0'), false);
  assert.equal(isNewerVersion('v2.2.0-beta.1', '2.1.0'), false);
});

test('update checker selects the matching installer and falls back to the release page', async () => {
  const windows = await checkForUpdate('2.1.0', 'win32', 'x64', reply(release));
  assert.equal(windows?.downloadUrl, release.assets[0].browser_download_url);
  const appleSilicon = await checkForUpdate('2.1.0', 'darwin', 'arm64', reply(release));
  assert.equal(appleSilicon?.downloadUrl, release.assets[1].browser_download_url);
  const intel = await checkForUpdate('2.1.0', 'darwin', 'x64', reply(release));
  assert.equal(intel?.downloadUrl, release.html_url);
});

test('update checker rejects untrusted release links', async () => {
  await assert.rejects(checkForUpdate('2.1.0', 'win32', 'x64', reply({
    ...release, html_url: 'https://example.com/release',
  })), /Invalid GitHub release URL/u);
  assert.equal(await checkForUpdate('2.2.0', 'win32', 'x64', reply(release)), null);
});
