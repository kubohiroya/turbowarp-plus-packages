import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadCatalog } from '../scripts/lib/catalog.ts';
import type { DashboardPackage, DashboardReport } from '../scripts/lib/types.ts';

test('dashboard separates runnable extensions, support and forks without losing category relationships', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-groups-'));
  try {
    const catalog = await loadCatalog(fileURLToPath(new URL('../catalog.yaml', import.meta.url)));
    const packages: DashboardPackage[] = catalog.entries.map((entry) => ({
      repo: entry.repo, label: entry.label, category: entry.category,
      dashboardGroup: entry.dashboardGroup, note: null, errors: [],
      manifest: {name: entry.npm, private: false, version: null, license: null},
    }));
    // A held, unpublished extension still belongs with runnable extensions.
    packages.find((pkg) => pkg.repo === 'turbowarp-runtime-expression')!.editorCatalogHold = 'not published yet';
    const deprecated = packages.find((pkg) => pkg.repo === 'turbowarp-3d-scene-dsl')!;
    deprecated.npm = {name: deprecated.manifest!.name!, published: true, deprecated: 'replaced',
      latest: '0.1.0'};
    // A new domain without an explicit role stays visible under support.
    packages.push({repo: 'future-library', label: 'future-library', category: 'future', note: null, errors: []});
    const report: DashboardReport = {
      owner: catalog.owner, scope: catalog.scope, generatedAt: '2026-11-21', site: {},
      categories: [...catalog.categories, {id: 'future', title: 'Future'}], packages,
    };
    for (const directory of ['scripts/lib', 'data', 'site']) await mkdir(join(root, directory), {recursive: true});
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
    const list = html.slice(html.indexOf('<section id="package-list"'), html.indexOf('</main>'));
    const groups = new Map([...list.matchAll(/<div class="package-group" data-package-group="([^"]+)"[\s\S]*?(?=<div class="package-group"|$)/g)]
      .map(([body, id]) => [id, body]));
    assert.deepEqual([...groups.keys()], ['use', 'editor', 'toolchain', 'extensions', 'infrastructure', 'forks']);
    const repos = (group: string) => [...groups.get(group)!.matchAll(/<tr [^>]*data-repo="([^"]+)"/g)].map(([, repo]) => repo!);
    assert.equal(repos('extensions').length, 42);
    assert.equal(repos('infrastructure').length, 13);
    assert.equal(repos('forks').length, 5);
    for (const repo of ['turbowarp-title-menu', 'turbowarp-runtime-expression', 'turbowarp-named-data',
      'turbowarp-named-functions', 'turbowarp-jotai-adapter', 'turbowarp-react-islands', 'turbowarp-diagnostic-overlay']) {
      assert.ok(repos('extensions').includes(repo), repo);
    }
    for (const repo of ['turbowarp-extension-template', 'turbowarp-extension-manifest', 'turbowarp-extension-data-editor',
      'turbowarp-document-source', 'turbowarp-app-shell', 'turbowarp-runtime-adapter', 'turbowarp-extension-loader',
      'turbowarp-extension-security-dialog',
      'turbowarp-live-reload-controller', 'turbowarp-app-template', 'turbowarp-scene-graph', 'qrcode-structured-append', 'future-library']) {
      assert.ok(repos('infrastructure').includes(repo), repo);
    }
    const rows = [...groups.keys()].flatMap(repos);
    assert.equal(rows.length, packages.length - 1);
    assert.equal(new Set(rows).size, rows.length);
    assert.ok(!rows.includes(deprecated.repo));
    assert.doesNotMatch(html, /Development Packages|開発用パッケージ/);
    assert.match(groups.get('extensions')!, /共通機能・UI/);
    assert.match(groups.get('infrastructure')!, /拡張開発基盤/);
    const listCategories = [...list.matchAll(/<section data-category="([^"]+)"/g)].map(([, id]) => id);
    const tocCategories = [...html.matchAll(/data-category-link="([^"]+)"/g)].map(([, id]) => id);
    assert.deepEqual(tocCategories, listCategories);
    assert.equal(new Set(listCategories).size, listCategories.length);
    // Both role-specific sections open the unchanged, complete domain graph.
    assert.equal([...list.matchAll(/data-graph-open="relationships-camera"/g)].length, 2);
    const graph = html.match(/<dialog[^>]*id="relationships-camera"[\s\S]*?<\/dialog>/)![0];
    assert.match(graph, /data-repo="turbowarp-camera-source"/);
    assert.match(graph, /data-repo="qrcode-structured-append"/);
    assert.equal([...html.matchAll(/<dialog[^>]*id="relationships-camera"/g)].length, 1);
    assert.doesNotMatch(html, /data-category-cycles/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
