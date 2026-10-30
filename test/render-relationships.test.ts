import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import type { DashboardPackage, DashboardReport } from '../scripts/lib/types.ts';

test('renders category graph buttons and labelled dialogs while keeping the dashboard list-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-relationships-'));
  const pkg = (repo: string, category: string): DashboardPackage => ({
    repo, category, label: repo, note: null, errors: [],
    manifest: { name: `@test/${repo}`, private: false, version: null, license: null },
  });
  const one = pkg('one', 'focus');
  one.label = '<unsafe & label>';
  one.dependencies = ['two', 'outside'].map((repo) => ({ name: `@test/${repo}`, range: '*',
    kind: 'dev', family: true, local: false, stale: false }));
  const report: DashboardReport = {
    generatedAt: '2026-10-30', owner: 'test', scope: '@test', site: {},
    categories: [{ id: 'focus', title: 'Focus', titleJa: '対象' }, { id: 'other', title: 'Other' }, { id: 'isolated', title: 'Isolated' }],
    packages: [one, pkg('two', 'focus'), pkg('outside', 'other'), pkg('alone', 'isolated')],
  };
  try {
    for (const directory of ['scripts/lib', 'data', 'site']) await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    for (const file of ['render.ts', 'lib/relationships.ts']) {
      await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(root, 'scripts', file));
    }
    await writeFile(join(root, 'data/dashboard.json'), JSON.stringify(report));
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/render.ts')], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(join(root, 'site/index.html'), 'utf8');
    assert.doesNotMatch(html, /class="content-nav"|role="tab"|id="package-relationships"|id="graph-category"/);
    const list = html.indexOf('<section id="package-list"');
    const end = html.indexOf('</main>', list);
    const listHtml = html.slice(list, end);
    assert.match(listHtml, /class="stats"/);
    assert.match(listHtml, /class="toolbar"/);
    assert.match(listHtml, /id="q"/);
    assert.equal([...listHtml.matchAll(/class="category-graph"/g)].length, 3);
    assert.equal([...html.matchAll(/<dialog class="relationship-dialog"/g)].length, 3);
    assert.ok(html.indexOf('<dialog class="relationship-dialog"') > end);
    assert.match(listHtml, /aria-haspopup="dialog" aria-controls="relationships-focus"/);
    assert.match(html, /id="relationships-focus" aria-labelledby="graph-heading-focus"/);
    assert.match(html, /data-graph-close autofocus/);
    assert.match(html, /regardless of list filters/);
    assert.match(html, /dialog.showModal\(\)/);
    assert.equal([...html.matchAll(/<tr data-search=/g)].length, 4);
    assert.equal([...html.matchAll(/<section data-graph-category=/g)].length, 3);
    assert.equal([...html.matchAll(/class="graph-edge aggregate"/g)].length, 2);
    assert.equal([...html.matchAll(/class="graph-edge"/g)].length, 1);
    assert.match(html, /&lt;unsafe &amp; label&gt;/);
    assert.doesNotMatch(html, /<unsafe/);
    assert.match(html, /No declared relations with other catalog categories/);
    assert.match(html, /Exact internal relations/);
    assert.match(html, /outside<\/a> <span class="muted">\(dev\)/);
    assert.match(html, /Dashed: outside-category aggregates/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /data-freshness="warning"/);
    // A recent snapshot needs the exact catalog that produced it. A stale or
    // mismatched snapshot must be visibly labelled on the list and each dialog.
    const catalogSource = 'fixture catalog bytes\n';
    await writeFile(join(root, 'catalog.yaml'), catalogSource);
    report.generatedAt = new Date().toISOString();
    report.catalog = { sha256: createHash('sha256').update(catalogSource).digest('hex'), revision: null };
    const rerender = async () => {
      await writeFile(join(root, 'data/dashboard.json'), JSON.stringify(report));
      const result = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/render.ts')], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10000,
      });
      assert.equal(result.status, 0, result.stderr);
      return readFile(join(root, 'site/index.html'), 'utf8');
    };
    assert.equal([...(await rerender()).matchAll(/data-freshness="verified"/g)].length, 4);
    await writeFile(join(root, 'catalog.yaml'), catalogSource + 'changed');
    assert.equal([...(await rerender()).matchAll(/data-freshness="warning"/g)].length, 4);
    await writeFile(join(root, 'catalog.yaml'), catalogSource);
    report.generatedAt = '2000-01-01T00:00:00Z';
    assert.match(await rerender(), /data-freshness="warning"/);
    report.generatedAt = new Date().toISOString();
    report.packages[0]!.errors.push('repository metadata unavailable');
    assert.match(await rerender(), /data-freshness="warning"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
