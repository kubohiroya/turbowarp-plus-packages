import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { DashboardPackage, DashboardReport } from '../scripts/lib/types.ts';

test('Demo precedes Issues and opens only available SB3s in TurboWarp-Plus-Editor in a new tab', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-demos-'));
  const projectUrl = 'https://example.org/samples/hello-world.sb3?x=1&y=2';
  const title = 'Hello "world" <demo>';
  const pkg = (repo: string): DashboardPackage => ({ repo, label: repo, category: 'data', note: null, errors: [] });
  const report: DashboardReport = {
    generatedAt: '2026-10-27T00:00:00Z', owner: 'test', scope: '@test', site: {},
    categories: [{ id: 'data', title: 'Data' }],
    packages: [
      { ...pkg('ready'), demo: { projectUrl, title } },
      pkg('missing'),
      { ...pkg('unpublished'), demo: null },
      { ...pkg('invalid'), demo: { projectUrl: 'javascript:alert(1)', title: 'Unsafe' } },
    ],
  };
  try {
    for (const directory of ['scripts', 'data', 'site']) await mkdir(join(root, directory));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await copyFile(new URL('../scripts/render.ts', import.meta.url), join(root, 'scripts/render.ts'));
    async function render() {
      await writeFile(join(root, 'data/dashboard.json'), JSON.stringify(report));
      const result = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/render.ts')], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10000,
      });
      assert.equal(result.status, 0, result.stderr);
      return readFile(join(root, 'site/index.html'), 'utf8');
    }
    const html = await render();
    assert.match(html, /<th><span lang="en">Demo<\/span><span lang="ja">Demo<\/span><\/th><th><span lang="en">Issues/);
    const rows = [...html.matchAll(/<tr data-search=[\s\S]*?<\/tr>/g)].map(match => match[0]);
    assert.equal(rows.length, 4);
    assert.equal([...rows[0].matchAll(/<td\b/g)].length, 8);
    const link = rows[0].match(/<a class="demo-play twpe-edit-button twpe-edit-button--small" href="([^"]+)"[^>]*>/)?.[0];
    assert.ok(link);
    const href = link.match(/href="([^"]+)"/)![1].replaceAll('&amp;', '&');
    const url = new URL(href);
    assert.equal(`${url.origin}${url.pathname}`, 'https://kubohiroya.github.io/turbowarp-plus-editor/editor.html');
    assert.equal(url.searchParams.get('project_url'), projectUrl);
    assert.equal(url.searchParams.get('project_title'), title);
    assert.match(link, /target="_blank" rel="noopener noreferrer"/);
    assert.match(rows[0], /<img src="https:\/\/kubohiroya.github.io\/turbowarp-plus-editor\/assets\/icon.svg" alt="" width="24" height="24">/);
    assert.match(rows[0], /<span lang="en">Edit<\/span><span lang="ja">編集<\/span>/);
    assert.match(link, /title="Edit in TurboWarp-Plus-Editor"/);
    assert.match(rows[0], /TurboWarp-Plus-Editorで編集/);
    assert.match(rows[0], /Hello &quot;world&quot; &lt;demo&gt;/);
    assert.match(rows[0], /新しいタブ/);
    for (const row of rows.slice(1)) {
      assert.doesNotMatch(row, /demo-play|javascript:/);
      assert.match(row, /<td class="demo"><span class="muted">—<\/span><\/td>/);
    }

    report.site.demoEditorUrl = 'https://plus.example/editor.html?lang=ja';
    const custom = await render();
    assert.match(custom, /href="https:\/\/plus.example\/editor.html\?lang=ja&amp;project_url=/);
    report.site.demoEditorUrl = 'javascript:alert(1)';
    assert.doesNotMatch(await render(), /<a class="demo-play twpe-edit-button twpe-edit-button--small"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
