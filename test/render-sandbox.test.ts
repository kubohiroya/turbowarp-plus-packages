import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { DashboardReport, UnsandboxedRequirement } from '../scripts/lib/types.ts';

test('renders distinct bilingual sandbox requirements and supports older snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-sandbox-'));
  const states: (UnsandboxedRequirement | undefined)[] = ['required', 'optional', 'not-needed', 'unknown', undefined];
  const report: DashboardReport = {
    generatedAt: '2026-10-28T00:00:00Z', owner: 'test', scope: '@test', site: {},
    categories: [{ id: 'data', title: 'Data' }, { id: 'apps', title: 'Applications' }],
    packages: [...states.map((unsandboxed, i) => ({
      repo: `extension-${i}`, label: `Extension ${i}`, category: 'data', note: null, errors: [], unsandboxed,
    })),
    { repo: 'extension-inherited', label: 'extension-inherited', category: 'data', note: null, errors: [], unsandboxed: 'not-needed', unsandboxedRequiredBy: ['extension-"<required>'] },
    { repo: 'app-inherited', label: 'app-inherited', category: 'apps', note: null, errors: [], unsandboxedRequiredBy: ['extension-"<required>'] },
    { repo: 'app-override', label: 'app-override', category: 'apps', note: null, errors: [], unsandboxed: 'not-needed', unsandboxedRequiredBy: ['extension-0'] },
    { repo: 'app-no-requirement', label: 'app-no-requirement', category: 'apps', note: null, errors: [] },
    ],
  };
  try {
    for (const dir of ['scripts', 'data', 'site']) await mkdir(join(root, dir));
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
    const rows = [...html.matchAll(/<tr data-search=[\s\S]*?<\/tr>/g)].map(([row]) => row);
    // Display groups can reorder categories; identify rows by package instead.
    const rowFor = (repo: string) => {
      const row = rows.find((row) => row.startsWith(`<tr data-search="${repo} `));
      assert.ok(row, `Missing row for ${repo}`);
      return row;
    };
    for (const [i, [style, icon, en, ja]] of [
      ['warn', '🔓', 'required', '必須'], ['idle', '◐', 'optional', '任意'],
      ['ok', '🛡', 'not needed', '不要'], ['idle', '?', 'unknown', '不明'],
    ].entries()) {
      assert.ok(rowFor(`extension-${i}`).includes(`<span class="tag ${style}"><span aria-hidden="true">${icon}</span>`));
      assert.ok(rowFor(`extension-${i}`).includes(`<span lang="en">Without sandbox: ${en}</span>`));
      assert.ok(rowFor(`extension-${i}`).includes(`<span lang="ja">サンドボックスなし：${ja}</span>`));
    }
    assert.doesNotMatch(rowFor('extension-4'), /sandbox-status|Without sandbox|サンドボックスなし/);
    assert.match(rowFor('extension-inherited'), /title="extension-&quot;&lt;required&gt;"/);
    for (const row of [rowFor('extension-inherited'), rowFor('app-inherited'), rowFor('app-override')]) {
      assert.match(row, /Without sandbox: required/);
      assert.match(row, /サンドボックスなし：必須/);
      assert.doesNotMatch(row, /サンドボックスなし：不要/);
    }
    assert.doesNotMatch(rowFor('app-no-requirement'), /sandbox-status|Without sandbox|サンドボックスなし/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
