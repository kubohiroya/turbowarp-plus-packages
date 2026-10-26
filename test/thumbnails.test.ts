import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {generateThumbnails, thumbnailKey, type Target} from '../scripts/thumbnails.ts';

function pkg(version = '1.0.0'): Target {
  return {
    repo: 'example', label: 'example', category: 'extensions', note: null, errors: [],
    pages: {enabled: true, url: 'https://example.com/'},
    manifest: {version, name: 'example', private: false, license: null},
    revision: {head: {oid: 'abc', committedDate: ''}, tag: null, release: null, state: 'untagged', aheadBy: null},
  };
}

test('release versions ignore commit-only changes; RC, tag, dist-tag and URL changes invalidate', () => {
  const original = pkg();
  const changed = structuredClone(original);
  changed.revision!.head!.oid = 'def';
  assert.equal(thumbnailKey(original), thumbnailKey(changed));
  for (const changed of [
    {...original, manifest: {...original.manifest!, version: '1.0.1-rc.1'}},
    {...original, revision: {...original.revision!, tag: {name: 'v1.1.0', oid: null, committedDate: null}}},
    {...original, npm: {name: 'example', published: true, distTags: {next: '1.1.0-rc.1'}}},
    {...original, pages: {...original.pages, url: 'https://example.com/new/'}},
  ]) assert.notEqual(thumbnailKey(original), thumbnailKey(changed));
  assert.equal(
    thumbnailKey({...original, npm: {name: 'example', published: true, distTags: {latest: '1.0.0', next: '1.1.0-rc.1'}}}),
    thumbnailKey({...original, npm: {name: 'example', published: true, distTags: {next: '1.1.0-rc.1', latest: '1.0.0'}}}),
  );
  const unversioned = {...original, manifest: null};
  assert.notEqual(thumbnailKey(unversioned), thumbnailKey({...unversioned, revision: changed.revision}));
});

test('reuse skips capture; missing dark image retries; failed refresh retains old key until success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'thumbnail-test-'));
  try {
    let calls = 0;
    const capture = async (packages: Target[]) => {
      calls++;
      for (const p of packages) {
        await writeFile(join(directory, `${p.repo}.light.png`), 'light');
        await writeFile(join(directory, `${p.repo}.dark.png`), 'dark');
      }
      return packages.map((p) => ({repo: p.repo, ok: true as const, dark: true}));
    };
    await generateThumbnails([pkg()], directory, capture);
    const reused = await generateThumbnails([pkg()], directory, capture);
    assert.equal(calls, 1);
    assert.equal(reused.reused, 1);
    await rm(join(directory, 'example.dark.png'));
    await generateThumbnails([pkg()], directory, capture);
    assert.equal(calls, 2);
    const newer = pkg('1.1.0');
    const failed = await generateThumbnails([newer], directory, async () => [
      {repo: 'example', ok: false, scheme: 'dark', reason: 'HTTP 503'},
    ]);
    assert.equal(failed.failed.length, 1);
    const snapshot = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'));
    assert.equal(snapshot.snapshots.example.key, thumbnailKey(pkg()));
    assert.deepEqual(snapshot.withDarkVariant, ['example']);
    await generateThumbnails([newer], directory, capture);
    assert.equal(calls, 3);
    await generateThumbnails([newer], directory, capture);
    assert.equal(calls, 3);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('legacy index without version snapshots refreshes once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'thumbnail-legacy-'));
  try {
    await writeFile(join(directory, 'index.json'), JSON.stringify({captured: ['example']}));
    let pending = 0;
    await generateThumbnails([pkg()], directory, async (packages) => {
      pending = packages.length;
      return [{repo: 'example', ok: false, scheme: 'light', reason: 'offline'}];
    });
    assert.equal(pending, 1);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
