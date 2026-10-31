import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLatestRelease } from './update-core';

test('accepts a newer stable release from the project repository', () => {
  assert.deepEqual(parseLatestRelease({
    tag_name: 'v2.3.0',
    html_url: 'https://github.com/Lueyu/squabble/releases/tag/v2.3.0',
    draft: false,
    prerelease: false,
  }, '2.2.0'), {
    version: '2.3.0',
    releaseUrl: 'https://github.com/Lueyu/squabble/releases/tag/v2.3.0',
  });
});

test('ignores old and prerelease versions and rejects foreign URLs', () => {
  const release = { tag_name: 'v2.2.0', html_url: 'https://github.com/Lueyu/squabble/releases/tag/v2.2.0' };
  assert.equal(parseLatestRelease(release, '2.2.0'), null);
  assert.equal(parseLatestRelease({ ...release, tag_name: 'v2.3.0-beta.1' }, '2.2.0'), null);
  assert.equal(parseLatestRelease({ ...release, prerelease: true }, '2.1.0'), null);
  assert.throws(() => parseLatestRelease({ ...release, html_url: 'https://example.com/fake' }, '2.1.0'));
});
