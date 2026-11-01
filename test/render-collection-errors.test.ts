import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { DashboardPackage, DashboardReport } from '../scripts/lib/types.ts';

async function renderWarning(packages: DashboardPackage[]) {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-collection-errors-'));
  // A recent snapshot of the current catalog, so only collection can warn.
  const catalog = 'owner: test\n';
  const report: DashboardReport = {
    generatedAt: new Date().toISOString(), owner: 'test', scope: '@test', site: {},
    catalog: { sha256: createHash('sha256').update(catalog).digest('hex'), revision: null },
    categories: [{ id: 'data', title: 'Data' }],
    packages,
  };
  try {
    for (const directory of ['scripts', 'data', 'site']) await mkdir(join(root, directory));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(root, 'catalog.yaml'), catalog);
    await copyFile(new URL('../scripts/render.ts', import.meta.url), join(root, 'scripts/render.ts'));
    await mkdir(join(root, 'scripts/lib'), { recursive: true });
    await copyFile(new URL('../scripts/lib/relationships.ts', import.meta.url), join(root, 'scripts/lib/relationships.ts'));
    await writeFile(join(root, 'data/dashboard.json'), JSON.stringify(report));
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/render.ts')], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(join(root, 'site/index.html'), 'utf8');
    return html.match(/<p class="data-warning" role="status">([\s\S]*?)<\/p>/)?.[1] ?? null;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const pkg = (repo: string, errors: string[] = []): DashboardPackage => ({
  repo, label: repo, category: 'data', note: null, errors,
});

test('the freshness warning names each package that failed to collect', async () => {
  const one = await renderWarning([pkg('healthy'), pkg('broken', ['npm: timeout'])]);
  assert.ok(one);
  assert.match(one, /<span lang="en">Collection failed for 1 package: broken\.<\/span>/);
  assert.match(one, /<span lang="ja">1件のパッケージを取得できませんでした：broken。<\/span>/);
  assert.doesNotMatch(one, /healthy/);

  const two = await renderWarning([pkg('first', ['repository not found']), pkg('healthy'), pkg('<second>', ['revision: 404'])]);
  assert.ok(two);
  assert.match(two, /Collection failed for 2 packages: first, &lt;second&gt;\./);
  assert.match(two, /2件のパッケージを取得できませんでした：first、&lt;second&gt;。/);
});

test('no freshness warning when every package was collected', async () => {
  assert.equal(await renderWarning([pkg('healthy')]), null);
});
