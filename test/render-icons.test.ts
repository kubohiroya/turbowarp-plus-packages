import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { DashboardPackage, DashboardReport } from '../scripts/lib/types.ts';

test('render prefers app favicons, escapes URLs, and preserves other icons and missing-icon rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-icons-'));
  const blockIcon = '<svg id="block-icon"></svg>';
  const pkg = (repo: string, category: string, icon: string | null, favicon: string | null): DashboardPackage => ({
    repo, label: repo, category, note: null, errors: [], icon,
    pages: { enabled: true, svgFaviconUrl: favicon },
  });
  const report: DashboardReport = {
    generatedAt: '2026-10-25T00:00:00Z', owner: 'test', scope: '@test', site: {},
    categories: [{ id: 'apps', title: 'Applications' }, { id: 'kamishibai', title: 'Kamishibai' },
      { id: 'in-development', title: 'Other (in development)' }, { id: 'toolchain', title: 'Toolchain' }],
    packages: [
      pkg('app-with-favicon', 'apps', blockIcon, 'https://example.org/icon.svg?a=1&b="2"'),
      pkg('app-with-block', 'apps', blockIcon, null),
      pkg('app-without-icon', 'apps', null, null),
      pkg('extension', 'toolchain', blockIcon, 'https://example.org/unused.svg'),
      { ...pkg('app-with-png', 'apps', null, null), pages: { enabled: true,
        svgFaviconUrl: null, faviconUrl: 'https://example.org/favicon.png' } },
      { ...pkg('app-with-both', 'apps', blockIcon, 'https://example.org/preferred.svg'),
        pages: { enabled: true, svgFaviconUrl: 'https://example.org/preferred.svg',
          faviconUrl: 'https://example.org/fallback.png' } },
      { ...pkg('kamishibai-app', 'kamishibai', blockIcon, 'https://example.org/kamishibai.svg'), application: true },
      pkg('kamishibai-docs', 'kamishibai', blockIcon, 'https://example.org/docs.svg'),
      { ...pkg('other-app', 'in-development', blockIcon, 'https://example.org/other.svg'), application: true },
    ],
  };
  try {
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'data'));
    await mkdir(join(root, 'site'));
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
    const rows = [...html.matchAll(/<tr data-search=[\s\S]*?<\/tr>/g)].map((row) => row[0]);
    assert.equal(rows.length, 9);
    assert.match(rows[0], /<img class="icon" src="https:\/\/example.org\/icon.svg\?a=1&amp;b=&quot;2&quot;" alt="" width="20" height="20">/);
    assert.doesNotMatch(rows[0], /block-icon/);
    assert.match(rows[1], /<span class="icon" aria-hidden="true"><svg id="block-icon"><\/svg><\/span>/);
    assert.doesNotMatch(rows[2], /class="icon"/);
    assert.match(rows[3], /class="icon" src="https:\/\/example.org\/favicon.png"/);
    assert.match(rows[4], /preferred.svg/);
    assert.doesNotMatch(rows[4], /fallback.png|block-icon/);
    assert.match(rows[5], /kamishibai.svg/);
    assert.doesNotMatch(rows[5], /block-icon/);
    assert.match(rows[6], /block-icon/);
    assert.doesNotMatch(rows[6], /docs.svg/);
    assert.match(rows[7], /other.svg/);
    assert.doesNotMatch(rows[7], /block-icon/);
    assert.match(rows[8], /block-icon/);
    assert.doesNotMatch(rows[8], /unused.svg/);
    const graphNode = (repo: string) => html.match(new RegExp(
      `<g class="graph-node primary" data-repo="${repo}">[\\s\\S]*?<\\/g>`))?.[0] ?? '';
    assert.match(graphNode('app-with-favicon'), /package-graph-label[\s\S]*class="icon" src="https:\/\/example.org\/icon.svg/);
    assert.match(graphNode('app-with-block'), /class="icon" src="data:image\/svg\+xml,%3Csvg%20id%3D%22block-icon/);
    assert.match(graphNode('app-without-icon'), /package-graph-label[\s\S]*<svg class="category-icon"/);
    assert.doesNotMatch(graphNode('app-with-block'), /<svg id="block-icon"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
