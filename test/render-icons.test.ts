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
    categories: [{ id: 'apps', title: 'Applications' }, { id: 'toolchain', title: 'Toolchain' }],
    packages: [
      pkg('app-with-favicon', 'apps', blockIcon, 'https://example.org/icon.svg?a=1&b="2"'),
      pkg('app-with-block', 'apps', blockIcon, null),
      pkg('app-without-icon', 'apps', null, null),
      pkg('extension', 'toolchain', blockIcon, 'https://example.org/unused.svg'),
    ],
  };
  try {
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'data'));
    await mkdir(join(root, 'site'));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await copyFile(new URL('../scripts/render.ts', import.meta.url), join(root, 'scripts/render.ts'));
    await writeFile(join(root, 'data/dashboard.json'), JSON.stringify(report));
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/render.ts')], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(join(root, 'site/index.html'), 'utf8');
    const rows = [...html.matchAll(/<tr data-search=[\s\S]*?<\/tr>/g)].map((row) => row[0]);
    assert.equal(rows.length, 4);
    assert.match(rows[0], /<img class="icon" src="https:\/\/example.org\/icon.svg\?a=1&amp;b=&quot;2&quot;" alt="" width="20" height="20">/);
    assert.doesNotMatch(rows[0], /block-icon/);
    assert.match(rows[1], /<span class="icon" aria-hidden="true"><svg id="block-icon"><\/svg><\/span>/);
    assert.doesNotMatch(rows[2], /class="icon"/);
    assert.match(rows[3], /block-icon/);
    assert.doesNotMatch(rows[3], /unused.svg/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
