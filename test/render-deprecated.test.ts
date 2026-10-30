import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { DashboardPackage, DashboardReport } from '../scripts/lib/types.ts';

test('render omits deprecated rows, empty categories and their summary counts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-deprecated-'));
  const pkg = (repo: string, category: string): DashboardPackage => ({
    repo, label: repo, category, note: null, errors: [],
  });
  const report: DashboardReport = {
    generatedAt: '2026-10-26T00:00:00Z', owner: 'test', scope: '@test', site: {},
    categories: [{ id: 'apps', title: 'Apps' }, { id: 'obsolete', title: 'Obsolete' }],
    packages: [
      { ...pkg('current', 'apps'), npm: { name: '@test/current', published: true, deprecated: null } },
      pkg('unpublished', 'apps'),
      { ...pkg('retired', 'obsolete'), npm: { name: '@test/retired', published: true, deprecated: 'Use current' },
        pages: { enabled: true }, revision: { state: 'unreleased', head: null, tag: null, release: null, aheadBy: null } },
    ],
  };
  try {
    for (const directory of ['scripts', 'data', 'site']) await mkdir(join(root, directory));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await copyFile(new URL('../scripts/render.ts', import.meta.url), join(root, 'scripts/render.ts'));
    await mkdir(join(root, 'scripts/lib'), { recursive: true });
    await copyFile(new URL('../scripts/lib/relationships.ts', import.meta.url), join(root, 'scripts/lib/relationships.ts'));
    await writeFile(join(root, 'data/dashboard.json'), JSON.stringify(report));
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/render.ts')], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(join(root, 'site/index.html'), 'utf8');
    assert.equal([...html.matchAll(/<tr data-search=/g)].length, 2);
    assert.doesNotMatch(html, /retired|data-category="obsolete"/);
    const counts = [...html.matchAll(/class="stat"><b>(\d+)<\/b>/g)].map((match) => Number(match[1]));
    assert.deepEqual(counts, [2, 1, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(JSON.parse(await readFile(join(root, 'data/dashboard.json'), 'utf8')).packages.length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
