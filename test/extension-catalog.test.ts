import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionHeader, assembleEditorCatalog, publishedExtension, type EditorExtension } from '../scripts/lib/extension-catalog.ts';
import type {DashboardPackage} from '../scripts/lib/types.ts';
const entry = (id: string): EditorExtension => ({id, name: id, package: `@owner/${id}`, version: '1.2.3', url: `https://cdn.test/${id}.js`, repository: 'https://github.com/owner/repo', dependencies: []});
test('published headers preserve the parent and translations without executing source', () => {
  const result=extensionHeader('// Name: Parent\n// ID: parent\n// Description[ja]: 日本語\n// Bundled extensions:\n// ID: child\nthrow Error("never execute");');
  assert.equal(result.id,'parent');assert.equal(result['description[ja]'],'日本語');
  assert.deepEqual(extensionHeader('const x=1;\n// ID: hidden'),{});
});
test('catalog carries extension-only runtime and peer edges from published manifests', () => {
  const result=assembleEditorCatalog('now',[
    {entry:entry('a'),manifest:{dependencies:{'@owner/b':'^1.0.0',react:'*'},peerDependencies:{'@owner/c':'^1.0.0'}}},
    {entry:entry('b'),manifest:{dependencies:{'@owner/c':'^1.0.0'}}},
    {entry:entry('c'),manifest:{}},
  ]);
  assert.deepEqual(result.extensions.map(e=>e.dependencies),[['b','c'],['c'],[]]);
  assert.equal(result.schemaVersion,1);
});
test('duplicates, incompatible versions and cycles fail the catalog build', () => {
  assert.throws(()=>assembleEditorCatalog('now',[{entry:entry('a'),manifest:{}},{entry:entry('a'),manifest:{}}]),/Duplicate/);
  assert.throws(()=>assembleEditorCatalog('now',[{entry:entry('a'),manifest:{dependencies:{'@owner/b':'^2.0.0'}}},{entry:entry('b'),manifest:{}}]),/Incompatible/);
  assert.throws(()=>assembleEditorCatalog('now',[{entry:entry('a'),manifest:{dependencies:{'@owner/b':'*'}}},{entry:entry('b'),manifest:{dependencies:{'@owner/a':'*'}}}]),/Cyclic/);
});

test('unavailable known extensions fail closed, while build-only libraries are excluded', () => {
  const records = [{entry: entry('a'), manifest: {dependencies: {'@owner/missing': '*'}}}];
  assert.throws(() => assembleEditorCatalog('now', records, new Set(['@owner/missing'])), /Missing extension dependency/);
  assert.deepEqual(assembleEditorCatalog('now', records).extensions[0].dependencies, []);
});

test('both runtime and peer constraints must hold, with one edge per extension', () => {
  const records = [{entry: entry('a'), manifest: {dependencies: {'@owner/b': '^1.0.0'}, peerDependencies: {'@owner/b': '^1.0.0'}}},
    {entry: entry('b'), manifest: {}}];
  assert.deepEqual(assembleEditorCatalog('now', records).extensions[0].dependencies, ['b']);
  assert.deepEqual(records[0].entry.dependencies, []);
  records[0].manifest.dependencies!['@owner/b'] = '^2.0.0';
  assert.throws(() => assembleEditorCatalog('now', records), /Incompatible/);
});

test('published artifact discovery uses exact versions, localized README and packaged banner', async t => {
  const base = 'https://cdn.jsdelivr.net/npm/@owner/a@1.2.3';
  const calls: string[] = [];
  const responses: Record<string, unknown> = {
    [`${base}/package.json`]: {name: '@owner/a', version: '1.2.3', jsdelivr: './dist/primary.js'},
    'https://data.jsdelivr.com/v1/package/npm/@owner/a@1.2.3/flat': {files: [
      {name: '/dist/a.js'}, {name: '/dist/primary.js'}, {name: '/assets/block-icon.svg'}, {name: '/README.ja.md'},
    ]},
    [`${base}/dist/primary.js`]: '// ID: a\n// Name: A\nthrow new Error("must not execute");',
    [`${base}/README.ja.md`]: '# A\n\nこれは日本語の説明です。',
  };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    assert.ok(Object.hasOwn(responses, url), `Unexpected request ${url}`);
    const value = responses[url];
    return new Response(typeof value === 'string' ? value : JSON.stringify(value));
  });
  const pkg = {repo: 'a', npm: {name: '@owner/a', latest: '1.2.3'}, github: {url: 'https://github.com/owner/a'}} as DashboardPackage;
  const result = await publishedExtension(pkg);
  assert.equal(result.entry.url, `${base}/dist/primary.js`);
  assert.equal(result.entry.banner, `${base}/assets/block-icon.svg`);
  assert.equal(result.entry.unsandboxed, 'unknown');
  assert.equal(result.entry.descriptions!.ja, 'これは日本語の説明です。');
  assert.ok(!calls.includes(`${base}/dist/a.js`));
});

test('published manifest mismatch and failed artifact requests stop generation', async t => {
  const pkg = {repo: 'a', npm: {name: '@owner/a', latest: '1.2.3'}} as DashboardPackage;
  t.mock.method(globalThis, 'fetch', async (url: string) => new Response(JSON.stringify(
    url.endsWith('/flat') ? {files: []} : {name: '@owner/a', version: '9.9.9'})));
  await assert.rejects(publishedExtension(pkg), /manifest mismatch/);
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', {status: 503}));
  await assert.rejects(publishedExtension(pkg), /HTTP 503/);
});

test('repository artifact stays ahead of generic variants when manifest hints are unavailable', async t => {
  const base = 'https://cdn.jsdelivr.net/npm/@owner/turbowarp-example@1.2.3';
  const responses: Record<string, unknown> = {
    [`${base}/package.json`]: {name: '@owner/turbowarp-example', version: '1.2.3', jsdelivr: './dist/missing.js', unpkg: './dist/also-missing.js'},
    'https://data.jsdelivr.com/v1/package/npm/@owner/turbowarp-example@1.2.3/flat': {files: [
      {name: '/dist/aaa-variant.js'}, {name: '/dist/turbowarp-example.js'},
    ]},
    [`${base}/dist/turbowarp-example.js`]: '// ID: example\n// Name: Primary\n',
  };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.ok(Object.hasOwn(responses, url), `Unexpected variant request ${url}`);
    const value = responses[url];
    return new Response(typeof value === 'string' ? value : JSON.stringify(value));
  });
  const pkg = {repo: 'turbowarp-example', npm: {name: '@owner/turbowarp-example', latest: '1.2.3'},
    github: {url: 'https://github.com/owner/turbowarp-example'}} as DashboardPackage;
  assert.equal((await publishedExtension(pkg)).entry.url, `${base}/dist/turbowarp-example.js`);
});
