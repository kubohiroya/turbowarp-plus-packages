import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import type {DashboardReport} from '../scripts/lib/types.ts';

test('the filter can find a renamed package by the former name in its displayed label', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-label-search-'));
  const report: DashboardReport = {
    generatedAt: new Date().toISOString(), owner: 'test', scope: '@test', site: {},
    categories: [{id: 'data', title: 'Data'}],
    packages: [{repo: 'turbowarp-document-source', category: 'data', note: null, errors: [],
      label: 'turbowarp-document-source (formerly turbowarp-embedded-yaml)',
      descriptions: {en: 'Document source tools', ja: '文書ソースの共通パッケージ', enSource: null, jaSource: null}}],
  };
  try {
    for (const directory of ['scripts', 'data', 'site']) await mkdir(join(root, directory));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await copyFile(new URL('../scripts/render.ts', import.meta.url), join(root, 'scripts/render.ts'));
    await mkdir(join(root, 'scripts/lib'), {recursive: true});
    await copyFile(new URL('../scripts/lib/relationships.ts', import.meta.url), join(root, 'scripts/lib/relationships.ts'));
    await writeFile(join(root, 'data/dashboard.json'), JSON.stringify(report));
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/render.ts')], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(join(root, 'site/index.html'), 'utf8');
    const search = html.match(/<tr data-search="([^"]+)" data-repo="turbowarp-document-source"/);
    assert.ok(search, 'the package row must expose its filter text');
    assert.ok(search[1].includes('turbowarp-embedded-yaml'), 'the visible former name must match the search filter');
    assert.ok(search[1].includes('document source tools'), 'English descriptions remain searchable');
    assert.ok(search[1].includes('文書ソース'), 'Japanese descriptions remain searchable');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
