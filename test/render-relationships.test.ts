import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import type { DashboardPackage, DashboardReport, Dependency } from '../scripts/lib/types.ts';

test('renders category graph buttons and labelled dialogs while keeping the dashboard list-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-relationships-'));
  const pkg = (repo: string, category: string): DashboardPackage => ({
    repo, category, label: repo, note: null, errors: [],
    manifest: { name: `@test/${repo}`, private: false, version: null, license: null },
  });
  const one = pkg('one', 'focus');
  one.label = '<unsafe & label>';
  one.dependencies = ['two', 'outside', 'unlisted'].map((repo) => ({ name: `@test/${repo}`, range: '*',
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
    assert.match(html, /Package relationships: <span class="dialog-category">Focus<\/span>/);
    assert.match(html, /パッケージ相関図: <span class="dialog-category">対象<\/span>/);
    assert.match(html, /addEventListener\('pointerdown'[\s\S]*pressedOnBackdrop && onBackdrop\(event\)\) dialog\.close\(\)/);
    const modal = html.slice(html.indexOf('<dialog class="relationship-dialog"'), html.indexOf('</dialog>'));
    assert.ok(modal.indexOf('class="panel graph-panel"') < modal.indexOf('class="graph-secondary"'));
    assert.ok(modal.indexOf('class="graph-secondary"') < modal.indexOf('class="data-as-of"'));
    assert.doesNotMatch(modal.slice(0, modal.indexOf('class="panel graph-panel"')), /class="graph-help"|class="data-as-of"|class="lead"/);
    assert.match(html, /regardless of list filters/);
    assert.match(html, /dialog.showModal\(\)/);
    assert.equal([...html.matchAll(/<tr data-search=/g)].length, 4);
    assert.equal([...html.matchAll(/<section data-graph-category=/g)].length, 3);
    assert.equal([...html.matchAll(/class="graph-edge aggregate development"/g)].length, 2);
    assert.doesNotMatch(html, /class="graph-edge aggregate"/);
    assert.equal([...html.matchAll(/data-edge-source="one"/g)].length, 1);
    assert.match(html, /class="graph-edge development"/);
    // Development dependencies are shown unless the reader clears the box.
    assert.match(html, /data-graph-mode="primary" hidden/);
    assert.match(html, /data-graph-mode="all">/);
    assert.match(html, /data-show-dev checked/);
    // Runtime arrows are solid blue; development-only ones are dashed at half
    // the width, inside the category (1.5) and toward other categories (2).
    assert.match(html, /\.graph-edge \{[^}]*stroke: var\(--runtime-edge\); stroke-width: 1\.5;/);
    assert.match(html, /\.graph-edge\.aggregate \{ stroke-width: 2; \}/);
    assert.doesNotMatch(html, /\.graph-edge(\.aggregate)? \{[^}]*dasharray/);
    assert.match(html, /\.graph-edge\.development \{[^}]*stroke-width: \.75; stroke-dasharray: 6 4;/);
    assert.match(html, /\.graph-edge\.aggregate\.development \{ stroke-width: 1; \}/);
    assert.match(html, /&lt;unsafe &amp; label&gt;/);
    assert.doesNotMatch(html, /<unsafe/);
    assert.match(html, /No declared relations with other catalog categories/);
    assert.match(html, /Exact package relationships/);
    assert.match(html, /development/);
    assert.match(html, /Not registered in the catalog/);
    assert.match(html, /@test\/unlisted/);
    assert.doesNotMatch(html, /class="graph-node[^>]*data-repo="unlisted"/);
    assert.match(html, /Translucent boxes show category names only/);
    const externalNodes = [...modal.matchAll(/<g class="graph-node external"[^>]*>[\s\S]*?<\/g>/g)];
    assert.equal(externalNodes.length, 1);
    for (const [node] of externalNodes) {
      assert.match(node, /data-category="other"/);
      assert.match(node, /<strong><span lang="en">Other<\/span>/);
      assert.doesNotMatch(node, /data-repo=|<a\b|outside|representative/);
    }
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /data-freshness="warning"/);
    assert.doesNotMatch(html, /data-category-cycles/);
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

    // Several packages in one outside category can depend on different editor
    // libraries. Keep each central endpoint and direction instead of implying
    // an extension depends on the editor distribution or a representative.
    const editor = pkg('turbowarp-plus-editor', 'foundation');
    const gui = pkg('scratch-gui', 'foundation');
    const api = pkg('turbowarp-extension-data-editor', 'foundation');
    const security = pkg('security', 'foundation');
    const dataA = pkg('data-a', 'data');
    const dataB = pkg('data-b', 'data');
    const dev = pkg('dev-only', 'toolchain');
    const dependency = (target: DashboardPackage, kind: Dependency['kind'] = 'prod') => ({
      name: target.manifest!.name!, range: '*', kind,
      family: true, local: false, stale: false,
    });
    editor.buildDependencies = [{ repo: gui.repo, revision: 'a'.repeat(40), sourceRevision: 'b'.repeat(40),
      sourcePath: 'site/source.json', contractPaths: ['scripts/site/source.ts', 'scripts/site/build.ts'] }];
    editor.dependencies = [dependency(api, 'dev')];
    gui.dependencies = [dependency(api), dependency(security)];
    dataA.dependencies = [dependency(api), dependency(security, 'dev')];
    dataB.dependencies = [dependency(api), dependency(security, 'optional')];
    api.dependencies = [dependency(dataB, 'optional')];
    dev.dependencies = [dependency(api, 'dev')];
    report.packages = [editor, gui, api, security, dataA, dataB, dev];
    report.categories = [{ id: 'foundation', title: 'Editor', titleJa: 'エディター' },
      { id: 'data', title: 'Data & Documents', titleJa: 'データ・ドキュメント' },
      { id: 'toolchain', title: '<Toolchain>', titleJa: 'ツールチェーン' }];
    const editorHtml = await rerender();
    const editorDialog = editorHtml.slice(editorHtml.indexOf('id="relationships-foundation"'), editorHtml.indexOf('</dialog>'));
    const variants = [...editorDialog.matchAll(/<svg class="relationship-svg"[\s\S]*?<\/svg>/g)].map(([svg]) => svg);
    assert.equal(variants.length, 2);
    const [primary, all] = variants as [string, string];
    for (const svg of variants) {
      const outside = [...svg.matchAll(/<g class="graph-node external"[^>]*>[\s\S]*?<\/g>/g)];
      for (const [node] of outside) assert.doesNotMatch(node, /data-repo=|<a\b|data-a|data-b|dev-only/);
      assert.match(svg, /Data &amp; Documents/);
      assert.match(svg, /データ・ドキュメント/);
      assert.match(svg, /データ編集の契約・API/);
      const incoming = [...svg.matchAll(/<path class="graph-edge aggregate"[^>]*data-external-category="data"[^>]*data-direction="incoming"[^>]*>[\s\S]*?<\/path>/g)];
      assert.equal(incoming.length, 2);
      assert.ok(incoming.some(([edge]) => edge.includes(`data-central-repo="${api.repo}"`) && edge.includes('· 2</title>')));
      assert.ok(incoming.some(([edge]) => edge.includes('data-central-repo="security"') && edge.includes('· 1</title>')));
      for (const [edge] of incoming) assert.match(edge, /d="M264 \d+ [^"]*,390 \d+" marker-end=/);
      assert.match(svg, /data-central-repo="turbowarp-extension-data-editor" data-direction="outgoing" d="M640 \d+ [^"]*,756 \d+"/);
      // A category related both ways is shown on both sides so that no arrow
      // points right to left.
      assert.match(svg, /<g class="graph-node external" data-category="data" data-direction="incoming">\s*<rect x="14"/);
      assert.match(svg, /<g class="graph-node external" data-category="data" data-direction="outgoing">\s*<rect x="756"/);
      const aggregates = [...svg.matchAll(/class="graph-edge aggregate[^"]*"[^>]* d="M(\d+) [^"]*,(\d+) \d+"/g)];
      assert.ok(aggregates.length >= 3);
      for (const [, startX, endX] of aggregates) assert.ok(Number(startX) < Number(endX), `${startX} → ${endX}`);
      assert.match(svg, /data-central-repo="turbowarp-extension-data-editor" data-direction="outgoing"/);
      assert.doesNotMatch(svg, /data-central-repo="turbowarp-plus-editor"|data-central-repo="scratch-gui"/);
      assert.match(svg, /data-edge-source="turbowarp-plus-editor" data-edge-target="scratch-gui" data-edge-kinds="build"/);
      assert.match(svg, /data-edge-source="scratch-gui" data-edge-target="turbowarp-extension-data-editor" data-edge-kinds="prod"/);
      assert.match(svg, /data-edge-source="scratch-gui" data-edge-target="security" data-edge-kinds="prod"/);
      assert.match(svg, /Fixed GUI/);
    }
    // Runtime and development-only pairs between the same category and central
    // package are counted on separate arrows that do not overlap.
    assert.doesNotMatch(primary, /class="graph-edge aggregate development"/);
    const toSecurity = (kind: string) => all.match(new RegExp(`<path class="graph-edge aggregate${kind}" data-external-category="data" data-central-repo="security" data-direction="incoming" d="M264 (\\d+) [^"]*,390 (\\d+)"[^>]*><title>[^<]*· 1</title>`));
    const runtimeToSecurity = toSecurity('');
    const developmentToSecurity = toSecurity(' development');
    assert.ok(runtimeToSecurity && developmentToSecurity);
    assert.ok(Number(runtimeToSecurity[2]) < Number(developmentToSecurity[2]));
    assert.match(all, /data-external-category="toolchain" data-central-repo="turbowarp-extension-data-editor"/);
    assert.match(all, /class="graph-edge aggregate development" data-external-category="toolchain"/);
    // Each count names the exact pairs it summarizes in a tooltip of its own.
    const tooltipIds = [...all.matchAll(/<g class="edge-count-label" data-external-category="data" data-central-repo="security" data-direction="incoming" data-tooltip="([^"]+)"/g)].map(([, id]) => id!);
    assert.equal(tooltipIds.length, 2);
    const [runtimeTip, developmentTip] = tooltipIds.map((id) =>
      editorDialog.match(new RegExp(`<div class="edge-tooltip" id="${id}" role="tooltip" hidden>([\\s\\S]*?)</div>`))![1]!);
    assert.match(runtimeTip!, /<strong><span lang="en">Data &amp; Documents<\/span>[^<]*<span lang="ja">データ・ドキュメント<\/span> → security<\/strong>/);
    assert.match(runtimeTip!, /Runtime and other non-development[\s\S]*1 package pair</);
    assert.match(runtimeTip!, /<li>data-b → security <span class="muted">\(<span lang="en">optional<\/span>/);
    assert.doesNotMatch(runtimeTip!, /data-a/);
    assert.match(developmentTip!, /Development only/);
    assert.match(developmentTip!, /<li>data-a → security <span class="muted">\(<span lang="en">development<\/span>/);
    assert.doesNotMatch(developmentTip!, /data-b/);
    const allIds = [...editorHtml.matchAll(/ id="(edge-tip-[^"]+)"/g)].map(([, id]) => id);
    assert.equal(new Set(allIds).size, allIds.length);
    for (const [, id] of editorHtml.matchAll(/data-tooltip="([^"]+)"/g)) assert.ok(allIds.includes(id!), id);
    // Hovering a box copies it and its arrows into a layer drawn above the
    // arrows but below the boxes.
    for (const svg of variants) {
      const layer = svg.indexOf('<g class="edge-highlight-layer" aria-hidden="true"></g>');
      assert.ok(layer > svg.lastIndexOf('class="graph-edge') && layer < svg.indexOf('<g class="graph-node'));
    }
    assert.match(editorHtml, /'\[data-edge-source="' \+ repo \+ '"\], \[data-edge-target="' \+ repo \+ '"\], \[data-central-repo="' \+ repo \+ '"\]'/);
    assert.match(editorHtml, /'\[data-external-category="' \+ CSS\.escape\(node\.dataset\.category\) \+ '"\]\[data-direction="' \+ node\.dataset\.direction \+ '"\]'/);
    assert.equal([...primary.matchAll(/data-edge-source=/g)].length, 3);
    assert.equal([...all.matchAll(/data-edge-source=/g)].length, 4);
    assert.doesNotMatch(primary, /data-external-category="toolchain"/);
    assert.match(all, /data-external-category="toolchain"/);
    assert.match(all, /&lt;Toolchain&gt;/);
    assert.doesNotMatch(all, /<Toolchain>/);
    assert.match(editorDialog, /同パッケージが提供するデータ編集の契約・APIの利用/);
    // api -> data-b and data-b -> api make Editor and Data depend on each other.
    // The list and both dialogs say so; a dialog outside the cycle does not.
    const cycleWarning = /<p class="data-warning" role="status" data-category-cycles><span lang="en">Categories depend on each other in a cycle: \{Data &amp; Documents, Editor\}\.[^<]*<\/span><span lang="ja">カテゴリ間の依存が循環しています：｛データ・ドキュメント、エディター｝。/g;
    assert.equal([...editorHtml.matchAll(cycleWarning)].length, 3);
    assert.match(editorDialog, cycleWarning);
    const toolchainDialog = editorHtml.slice(editorHtml.indexOf('id="relationships-toolchain"'));
    assert.doesNotMatch(toolchainDialog.slice(0, toolchainDialog.indexOf('</dialog>')), /data-category-cycles/);
    assert.match(editorDialog, /data-a<\/a> → <a[^>]*>turbowarp-extension-data-editor/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
