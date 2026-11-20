import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadCatalog } from '../scripts/lib/catalog.ts';
import type { DashboardPackage, DashboardReport } from '../scripts/lib/types.ts';

test('all deliberately excluded repositories explain their distribution channel in both languages', async () => {
  const catalog = await loadCatalog(fileURLToPath(new URL('../catalog.yaml', import.meta.url)));
  for (const entry of catalog.entries.filter(entry => !entry.npm)) {
    assert(entry.npmReason?.en.trim(), entry.repo); assert(entry.npmReason?.ja.trim(), entry.repo);
  }
});

test('distribution reasons require npm exclusion and both languages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'distribution-policy-'));
  try {
    const file = join(root, 'catalog.yaml');
    for (const override of [
      { npm: false, npmReason: { en: 'Site' } },
      { npm: false, npmReason: { en: ' ', ja: 'サイト' } },
      { npm: '@test/pkg', npmReason: { en: 'Site', ja: 'サイト' } },
    ]) {
      await writeFile(file, JSON.stringify({ owner: 'test', categories: [{ id: 'docs', packages: ['pkg'] }], overrides: { pkg: override } }));
      await assert.rejects(loadCatalog(file), /npmReason/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the dashboard labels upstream deltas separately and escapes distribution explanations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'distribution-render-'));
  const pkg = (repo: string): DashboardPackage => ({ repo, label: repo, category: 'forks', note: null, errors: [] });
  const report: DashboardReport = { generatedAt: '2026-11-21T00:00:00Z', owner: 'test', scope: '@test', site: {},
    categories: [{ id: 'forks', title: 'Forks' }], packages: [
      { ...pkg('vm'), revision: { state: 'fork', head: null, tag: null, release: null, aheadBy: 7033,
        upstream: { repository: 'TurboWarp/scratch-vm', branch: 'develop', head: 'b'.repeat(40), aheadBy: 8, behindBy: 0 } },
        npm: { name: null, published: false, notAPackage: true, reason: { en: 'Git source <img src=x>', ja: 'Git固定のソース' } } },
      { ...pkg('unknown'), revision: { state: 'fork', head: null, tag: null, release: null, aheadBy: null },
        npm: { name: null, published: false, notAPackage: true } },
    ] };
  try {
    for (const dir of ['scripts/lib', 'data', 'site']) await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    for (const file of ['scripts/render.ts', 'scripts/lib/relationships.ts']) await copyFile(new URL('../' + file, import.meta.url), join(root, file));
    await writeFile(join(root, 'data/dashboard.json'), JSON.stringify(report));
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/render.ts')], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(join(root, 'site/index.html'), 'utf8');
    assert.match(html, /上流比 8 先行 \/ 0 遅れ/); assert.doesNotMatch(html, /7033 コミット先行/);
    assert.match(html, /上流との比較は未取得/); assert.match(html, /配布方式の理由が未記録/);
    assert.match(html, /Git source &lt;img src=x&gt;/); assert.doesNotMatch(html, /<img src=x>/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
