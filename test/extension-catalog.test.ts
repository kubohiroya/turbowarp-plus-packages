import { createHash } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { extensionHeader, extensionDocsURL, extensionAuthor, extensionDisplayName, catalogEntryPresentation, assembleEditorCatalog, publishedExtension, collectEditorCatalog, type CatalogState, type EditorExtension } from '../scripts/lib/extension-catalog.ts';
import type {DashboardPackage, DashboardReport} from '../scripts/lib/types.ts';
const entry = (id: string): EditorExtension => ({id, name: id, package: `@owner/${id}`, version: '1.2.3', url: `https://cdn.test/${id}.js`, sha256: '0'.repeat(64), repository: 'https://github.com/owner/repo', dependencies: []});

test('family display names use a single TurboWarp prefix and hyphen-separated words, retaining product spelling', () => {
  for (const [name, expected] of [
    ['TurboWarp Title Menu', 'TurboWarp-Title-Menu'],
    ['Runtime Expression', 'TurboWarp-Runtime-Expression'],
    ['Named Data', 'TurboWarp-Named-Data'],
    ['WebUSB PaSoRi', 'TurboWarp-WebUSB-PaSoRi'],
    ['jsQR', 'TurboWarp-jsQR'],
    ['WebRTC Manual Pairing', 'TurboWarp-WebRTC-Manual-Pairing'],
    ['TurboWarp YAML/JSON', 'TurboWarp-YAML-JSON'],
    ['TurboWarp-A-Frame', 'TurboWarp-A-Frame'],
    ['TurboWarp-Sesame', 'TurboWarp-Sesame'],
    ['TurboWarp-WebRTC-QRCode-Pairing', 'TurboWarp-WebRTC-QRCode-Pairing'],
    ['TurboWarp-UUID', 'TurboWarp-UUID'],
    ['  TurboWarp  OpenAI Realtime API  ', 'TurboWarp-OpenAI-Realtime-API'],
  ]) {
    assert.equal(extensionDisplayName(name, '@kubohiroya/turbowarp-example'), expected);
    assert.equal(extensionDisplayName(expected, '@kubohiroya/turbowarp-example'), expected);
  }
});

test('display normalization does not rename third-party packages and exceptions require a recorded reason', () => {
  assert.equal(extensionDisplayName('Third Party Name', '@someone/turbowarp-example'), 'Third Party Name');
  assert.equal(extensionDisplayName('A Tool', '@kubohiroya/a-tool'), 'A Tool');
  assert.equal(extensionDisplayName('TurboWarp', '@kubohiroya/turbowarp-example', {
    '@kubohiroya/turbowarp-example': {name: 'Intentional Product Name', reason: 'Contractually fixed product spelling'},
  }), 'Intentional Product Name');
  assert.throws(() => extensionDisplayName('Example', '@kubohiroya/turbowarp-example', {
    '@kubohiroya/turbowarp-example': {name: 'Other Name', reason: ' '},
  }), /requires a name and reason/);
  assert.throws(() => extensionDisplayName('TurboWarp', '@kubohiroya/turbowarp-example'), /Missing extension display name/);
});

test('catalog display formatting preserves executable identity, immutable source and dependency edges', () => {
  const base = {...entry('base'), name: 'Named Data', package: '@kubohiroya/turbowarp-named-data'};
  const parent = {...entry('parent'), name: 'Runtime Expression', package: '@kubohiroya/turbowarp-runtime-expression'};
  const original = structuredClone([base, parent]);
  const catalog = assembleEditorCatalog('fixed-time', [
    {entry: base, manifest: {}},
    {entry: parent, manifest: {dependencies: {'@kubohiroya/turbowarp-named-data': '^1.0.0'}}},
  ]);
  assert.deepEqual(catalog.extensions.map(e => e.name), ['TurboWarp-Named-Data', 'TurboWarp-Runtime-Expression']);
  assert.deepEqual(catalog.extensions.map(({name, ...rest}) => rest), [
    {...base, dependencies: []}, {...parent, dependencies: ['base']},
  ].map(({name, ...rest}) => rest));
  assert.deepEqual([base, parent], original);
});

test('curated display icons replace only maintained family artwork and leave pinned JavaScript intact', () => {
  const original = {...entry('uuid'), package: '@kubohiroya/turbowarp-uuid', name: 'TurboWarp-UUID',
    banner: 'https://cdn.test/uuid@1.2.3/assets/block-icon.svg',
    url: 'https://cdn.test/uuid@1.2.3/dist/uuid.js'};
  const result = catalogEntryPresentation(original);
  assert.equal(result.banner, 'https://kubohiroya.github.io/turbowarp-plus-packages/assets/extension-icons/turbowarp-uuid.svg');
  assert.deepEqual({...result, banner: original.banner}, original);
  assert.deepEqual(catalogEntryPresentation({...original, package: '@other/turbowarp-uuid'}),
    {...original, package: '@other/turbowarp-uuid'});
});
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
    [`${base}/package.json`]: {name: '@owner/a', version: '1.2.3', jsdelivr: './dist/primary.js',
      author: {name: 'Published Author', url: 'http://author.example/'}},
    'https://data.jsdelivr.com/v1/package/npm/@owner/a@1.2.3/flat': {files: [
      {name: '/dist/a.js'}, {name: '/dist/primary.js'}, {name: '/assets/block-icon.svg'}, {name: '/README.ja.md'},
    ]},
    [`${base}/dist/primary.js`]: '// ID: a\n// Name: A\n// By: Header Author\nthrow new Error("must not execute");',
    [`${base}/README.ja.md`]: '# A\n\nこれは日本語の説明です。',
  };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    assert.ok(Object.hasOwn(responses, url), `Unexpected request ${url}`);
    const value = responses[url];
    return new Response(typeof value === 'string' ? value : JSON.stringify(value));
  });
  const pkg = {repo: 'a', category: 'data', npm: {name: '@owner/a', latest: '1.2.3'}, github: {url: 'https://github.com/owner/a'},
    pages: {enabled: true, url: 'https://owner.github.io/a/', live: true, httpStatus: 200}} as DashboardPackage;
  const result = await publishedExtension(pkg);
  assert.equal(result.entry.url, `${base}/dist/primary.js`);
  assert.equal(result.entry.banner, `${base}/assets/block-icon.svg`);
  assert.equal(result.entry.unsandboxed, 'unknown');
  assert.equal(result.entry.category, 'data');
  assert.equal(result.entry.docsURL, 'https://owner.github.io/a/');
  assert.equal(result.entry.package, '@owner/a');
  assert.equal(result.entry.author, 'Published Author');
  assert.equal(result.entry.authorURL, 'http://author.example/');
  assert.equal(result.entry.descriptions!.ja, 'これは日本語の説明です。');
  assert.ok(!calls.includes(`${base}/dist/a.js`));
});

test('documentation URLs use the verified Pages URL rather than an arbitrary repository homepage', () => {
  const pkg = {github: {homepageUrl: 'https://www.npmjs.com/package/@owner/a'},
    pages: {enabled: true, url: 'https://owner.github.io/a/', live: true, httpStatus: 200}} as DashboardPackage;
  assert.equal(extensionDocsURL(pkg), 'https://owner.github.io/a/');
});

test('documentation URLs are omitted when Pages is unavailable, unverified or not HTTPS', () => {
  const healthy = {enabled: true, url: 'https://owner.github.io/a/', live: true, httpStatus: 200};
  const pagesCases = [undefined, {...healthy, enabled: false}, {...healthy, live: false}, {...healthy, live: undefined},
    {...healthy, httpStatus: 404}, {...healthy, httpStatus: undefined}, {...healthy, url: undefined},
    {...healthy, url: 'http://owner.github.io/a/'}, {...healthy, url: 'https://user:password@owner.github.io/a/'},
    {...healthy, url: 'javascript:alert(1)'}, {...healthy, url: '/a/'}];
  for (const pages of pagesCases) {
    assert.equal(extensionDocsURL({pages, github: {homepageUrl: 'https://owner.github.io/a/'}} as DashboardPackage), undefined);
  }
});

test('published manifest author name and URL take priority over declaration headers', () => {
  for (const key of ['Author URL', 'Author-URL']) {
    const metadata = extensionHeader(`// Author: Header Author\n// By: Other Author\n// ${key}: https://author.example/profile\n`);
    assert.deepEqual(extensionAuthor(metadata, {author: {name: 'Manifest Author', url: 'https://manifest.example/'}}),
      {author: 'Manifest Author', authorURL: 'https://manifest.example/'});
    assert.deepEqual(extensionAuthor(metadata, {}), {author: 'Header Author'});
  }
});

test('author names fall back to headers while links use only the manifest author object', () => {
  const manifest = {author: {name: ' Manifest Author ', url: 'https://author.example/'}};
  assert.deepEqual(extensionAuthor({by: 'Manifest Author'}, manifest), {author: 'Manifest Author', authorURL: 'https://author.example/'});
  assert.deepEqual(extensionAuthor({}, manifest), {author: 'Manifest Author', authorURL: 'https://author.example/'});
  assert.deepEqual(extensionAuthor({author: 'Someone Else'}, manifest), {author: 'Manifest Author', authorURL: 'https://author.example/'});
  assert.deepEqual(extensionAuthor({}, {author: 'Named Person <person@example.test>'}), {author: 'Named Person'});
  assert.deepEqual(extensionAuthor({by: 'Header Person'}, {author: {url: 'http://author.example/'}}),
    {author: 'Header Person', authorURL: 'http://author.example/'});
  assert.deepEqual(extensionAuthor({}, {author: 'Named Person <person@example.test> (https://author.example/)'}), {author: 'Named Person'});
});

test('missing and unsafe author URLs never produce inferred profile links', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,author', '/profile', 'https://user:pass@author.example/']) {
    assert.deepEqual(extensionAuthor({by: 'Person', 'author-url': url}, {}), {author: 'Person'});
    assert.deepEqual(extensionAuthor({by: 'Person'}, {author: {name: 'Person', url}}), {author: 'Person'});
  }
  assert.deepEqual(extensionAuthor({by: 'Person'}, {}), {author: 'Person'});
  assert.deepEqual(extensionAuthor({}, {author: {url: 'https://author.example/'}}), {authorURL: 'https://author.example/'});
  assert.deepEqual(extensionAuthor({}, {}), {});
});

test('category definitions retain source order and headings without changing extensions or dependencies', () => {
  const categories = [
    {id: 'second', title: 'Second', titleJa: '二つ目'},
    {id: 'empty', title: 'Empty'},
    {id: 'first', title: 'First', titleJa: '一つ目'},
  ];
  const records = [
    {entry: {...entry('a'), category: 'first'}, manifest: {dependencies: {'@owner/b': '*'}}},
    {entry: {...entry('b'), category: 'second'}, manifest: {}},
  ];
  const catalog = assembleEditorCatalog('now', records, new Set(), categories);
  assert.deepEqual(catalog.categories, categories);
  assert.deepEqual(catalog.extensions.map(({id, category, dependencies}) => ({id, category, dependencies})), [
    {id: 'a', category: 'first', dependencies: ['b']}, {id: 'b', category: 'second', dependencies: []},
  ]);
  assert.equal(catalog.schemaVersion, 1);
  assert.notEqual(catalog.categories, categories);
  assert.notEqual(catalog.categories![0], categories[0]);
});

test('category-aware catalogs reject duplicate definitions, invalid headings and missing references', () => {
  const category = {id: 'data', title: 'Data'};
  const record = {entry: {...entry('a'), category: 'data'}, manifest: {}};
  assert.throws(() => assembleEditorCatalog('now', [record], new Set(), [category, category]), /Duplicate extension category/);
  assert.throws(() => assembleEditorCatalog('now', [record], new Set(), [{id: '', title: 'Data'}]), /Invalid extension category/);
  for (const id of [' data', 'data ', '-data', '_data', 'data.name', 'データ']) {
    assert.throws(() => assembleEditorCatalog('now', [], new Set(), [{id, title: 'Data'}]), /Invalid extension category/);
  }
  assert.throws(() => assembleEditorCatalog('now', [record], new Set(), [{id: 'data', title: ' '}]), /Invalid extension category/);
  for (const titleJa of ['', '   ']) {
    assert.throws(() => assembleEditorCatalog('now', [record], new Set(), [{id: 'data', title: 'Data', titleJa}]), /Invalid extension category/);
  }
  assert.throws(() => assembleEditorCatalog('now', [record], new Set(), []), /Unknown extension category/);
  assert.throws(() => assembleEditorCatalog('now', [{entry: entry('a'), manifest: {}}], new Set(), [category]), /Unknown extension category/);
});

test('legacy assembly without category definitions preserves entries without a category', () => {
  const catalog = assembleEditorCatalog('now', [{entry: entry('a'), manifest: {}}]);
  assert.ok(!Object.hasOwn(catalog, 'categories'));
  assert.ok(!Object.hasOwn(catalog.extensions[0], 'category'));
});

test('collection carries dashboard category order and localized headings into the generated JSON', async t => {
  const base = 'https://cdn.jsdelivr.net/npm/@owner/a@1.2.3';
  const responses: Record<string, unknown> = {
    [`${base}/package.json`]: {name: '@owner/a', version: '1.2.3'},
    'https://data.jsdelivr.com/v1/package/npm/@owner/a@1.2.3/flat': {files: [{name: '/dist/a.js'}]},
    [`${base}/dist/a.js`]: '// ID: a\n// Name: A\n',
  };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.ok(Object.hasOwn(responses, url), `Unexpected request ${url}`);
    const value = responses[url];
    return new Response(typeof value === 'string' ? value : JSON.stringify(value));
  });
  const report = {
    generatedAt: 'now', categories: [
      {id: 'empty', title: 'Empty', titleJa: null, description: 'Not emitted'},
      {id: 'data', title: 'Data', titleJa: 'データ', description: 'Not emitted'},
    ], packages: [{repo: 'a', category: 'data', unsandboxed: 'unknown',
      npm: {name: '@owner/a', latest: '1.2.3', published: true}, github: {url: 'https://github.com/owner/a'}}],
  } as DashboardReport;
  const {catalog: result} = await collectEditorCatalog(report);
  assert.deepEqual(result.categories, [{id: 'empty', title: 'Empty'}, {id: 'data', title: 'Data', titleJa: 'データ'}]);
  assert.equal(result.extensions[0].category, 'data');
  assert.deepEqual(result.extensions[0].dependencies, []);
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

test('published license uses the extension declaration before the package manifest fallback', async t => {
  const base = 'https://cdn.jsdelivr.net/npm/@owner/a@1.2.3';
  let declaration = '';
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === `${base}/package.json`) return new Response(JSON.stringify({name:'@owner/a',version:'1.2.3',license:'MPL-2.0'}));
    if (url.endsWith('/flat')) return new Response(JSON.stringify({files:[{name:'/dist/a.js'}]}));
    assert.equal(url,`${base}/dist/a.js`);
    return new Response(`// ID: a\n// Name: A\n${declaration}`);
  });
  const pkg = {repo:'a',npm:{name:'@owner/a',latest:'1.2.3'},github:{url:'https://github.com/owner/a'}} as DashboardPackage;
  const first = (await publishedExtension(pkg)).entry;
  assert.equal(first.license,'MPL-2.0');
  // The digest covers the exact served bytes, so an Editor can recognize an embedded copy.
  assert.equal(first.sha256, createHash('sha256').update('// ID: a\n// Name: A\n').digest('hex'));
  declaration = '// License: See the bundled extension notices below.\n';
  assert.equal((await publishedExtension(pkg)).entry.license,'See the bundled extension notices below.');
});

test('a prerelease latest selects the newest earlier non-deprecated stable artifact by default', async t => {
  const name = '@owner/a';
  const registryURL = `https://registry.npmjs.org/${name}`;
  const base = `https://cdn.jsdelivr.net/npm/${name}@1.3.0`;
  const responses: Record<string, unknown> = {
    [registryURL]: {versions: {
      '1.2.0': {}, '1.3.0': {}, '1.3.1': {deprecated: 'Withdrawn'},
      '1.4.0-rc.0': {}, '1.4.0': {}, '2.0.0': {}, invalid: {},
    }},
    [`${base}/package.json`]: {name, version: '1.3.0'},
    [`https://data.jsdelivr.com/v1/package/npm/${name}@1.3.0/flat`]: {files: [{name: '/dist/a.js'}]},
    [`${base}/dist/a.js`]: '// ID: a\n// Name: A\n',
  };
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    assert.ok(Object.hasOwn(responses, url), `Unexpected request ${url}`);
    const value = responses[url];
    return new Response(typeof value === 'string' ? value : JSON.stringify(value));
  });
  const pkg = {repo: 'a', category: 'data', npm: {name, latest: '1.4.0-rc.1'},
    github: {url: 'https://github.com/owner/a'}} as DashboardPackage;
  const result = await publishedExtension(pkg);
  assert.equal(result.entry.version, '1.3.0');
  assert.equal(result.entry.url, `${base}/dist/a.js`);
  assert.equal(pkg.npm!.latest, '1.4.0-rc.1');
  assert.ok(!calls.some(url => url.includes('@1.4.0-rc.1/')));
});

test('prerelease collection requires opt-in and still uses an immutable exact artifact', async t => {
  const name = '@owner/a';
  const version = '1.4.0-rc.1';
  const base = `https://cdn.jsdelivr.net/npm/${name}@${version}`;
  const pkg = {repo: 'a', category: 'data', npm: {name, latest: version, published: true},
    unsandboxed: 'required', github: {url: 'https://github.com/owner/a'}} as DashboardPackage;
  const report = {generatedAt: 'now', categories: [{id: 'data', title: 'Data'}], packages: [pkg]} as DashboardReport;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === `https://registry.npmjs.org/${name}`) return new Response(JSON.stringify({versions: {
      [version]: {}, '1.3.0': {deprecated: 'Withdrawn'},
    }}));
    if (url === `${base}/package.json`) return new Response(JSON.stringify({name, version}));
    if (url === `https://data.jsdelivr.com/v1/package/npm/${name}@${version}/flat`) {
      return new Response(JSON.stringify({files: [{name: '/dist/a.js'}]}));
    }
    assert.equal(url, `${base}/dist/a.js`);
    return new Response('// ID: a\n// Name: A\n');
  });
  await assert.rejects(collectEditorCatalog(report), /No non-deprecated stable version/);
  const {catalog: result} = await collectEditorCatalog(report, {allowPrerelease: true});
  assert.equal(result.extensions[0].version, version);
  assert.equal(result.extensions[0].url, `${base}/dist/a.js`);
});

test('a refused connection is retried, and the retry still yields the published artifact', async t => {
  const base = 'https://cdn.jsdelivr.net/npm/@owner/a@1.2.3';
  const tree = 'https://data.jsdelivr.com/v1/package/npm/@owner/a@1.2.3/flat';
  const responses: Record<string, unknown> = {
    [`${base}/package.json`]: {name: '@owner/a', version: '1.2.3'},
    [tree]: {files: [{name: '/dist/a.js'}]},
    [`${base}/dist/a.js`]: '// ID: a\n// Name: A\nthrow new Error("must not execute");',
  };
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    // The failure that cost us a dashboard build: the connection never opened.
    if (url === tree && calls.filter(call => call === tree).length === 1) {
      throw new TypeError('fetch failed');
    }
    const value = responses[url];
    return new Response(typeof value === 'string' ? value : JSON.stringify(value));
  });
  const pkg = {repo: 'a', category: 'data', npm: {name: '@owner/a', latest: '1.2.3'},
    github: {url: 'https://github.com/owner/a'}} as DashboardPackage;
  assert.equal((await publishedExtension(pkg)).entry.url, `${base}/dist/a.js`);
  assert.equal(calls.filter(call => call === tree).length, 2);
});

test('a missing file is asked for once, while an unreachable host is named after the last attempt', async t => {
  const pkg = {repo: 'a', npm: {name: '@owner/a', latest: '1.2.3'}} as DashboardPackage;

  const missing: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    missing.push(url);
    return new Response('missing', {status: 404});
  });
  await assert.rejects(publishedExtension(pkg), /HTTP 404/);
  assert.deepEqual(missing.map(url => missing.filter(call => call === url).length), [1, 1]);

  const refused: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    refused.push(url);
    throw new TypeError('fetch failed');
  });
  await assert.rejects(publishedExtension(pkg), /cdn\.jsdelivr\.net.*: unreachable/);
  assert.equal(refused.filter(url => url.endsWith('/package.json')).length, 3);
});

test('a sibling request is abandoned once its partner has failed for good', async t => {
  const pkg = {repo: 'a', npm: {name: '@owner/a', latest: '1.2.3'}} as DashboardPackage;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.endsWith('/package.json')) return new Response('missing', {status: 404});
    // The file tree never answers by itself: only the abort can end this wait,
    // and a retried request would show up as a second call below.
    return new Promise<Response>((_resolve, reject) =>
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {once: true}));
  });
  await assert.rejects(publishedExtension(pkg), /HTTP 404/);
  assert.equal(calls.filter(url => url.endsWith('/flat')).length, 1);
});

test('an already aborted caller stops before the first retry', async t => {
  const pkg = {repo: 'a', npm: {name: '@owner/a', latest: '1.2.3'}} as DashboardPackage;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push(url);
    init!.signal!.throwIfAborted();
    throw new TypeError('fetch failed');
  });
  await assert.rejects(publishedExtension(pkg, {signal: AbortSignal.abort()}));
  // The pair starts together, and neither reaches a second attempt.
  assert.equal(calls.length, 2);
});

/** One working package that depends on one the CDN refuses to serve. */
function dependentPair(): {report: DashboardReport; carried: CatalogState['published'][number]} {
  return {
    report: {
      generatedAt: 'now',
      categories: [{id: 'data', title: 'Data', titleJa: 'データ', description: 'Not emitted'}],
      packages: [
        {repo: 'a', category: 'data', unsandboxed: 'unknown', npm: {name: '@owner/a', latest: '1.2.3', published: true},
          github: {url: 'https://github.com/owner/a'}},
        {repo: 'b', category: 'data', unsandboxed: 'unknown', npm: {name: '@owner/b', latest: '1.0.0', published: true},
          github: {url: 'https://github.com/owner/b'}},
      ],
    } as DashboardReport,
    carried: {
      entry: {id: 'b', name: 'B', package: '@owner/b', version: '1.0.0', sha256: '1'.repeat(64),
        url: 'https://cdn.jsdelivr.net/npm/@owner/b@1.0.0/dist/b.js', repository: 'https://github.com/owner/b',
        // Both are re-read from the report when the entry is carried over.
        category: 'moved-away', docsURL: 'https://owner.github.io/b/', dependencies: []},
      manifest: {name: '@owner/b', version: '1.0.0'},
    },
  };
}

function mockPairFetch(t: TestContext) {
  const base = 'https://cdn.jsdelivr.net/npm/@owner/a@1.2.3';
  const responses: Record<string, unknown> = {
    [`${base}/package.json`]: {name: '@owner/a', version: '1.2.3', dependencies: {'@owner/b': '^1.0.0'}},
    'https://data.jsdelivr.com/v1/package/npm/@owner/a@1.2.3/flat': {files: [{name: '/dist/a.js'}]},
    [`${base}/dist/a.js`]: '// ID: a\n// Name: A\n',
  };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (!Object.hasOwn(responses, url)) return new Response('missing', {status: 404});
    const value = responses[url];
    return new Response(typeof value === 'string' ? value : JSON.stringify(value));
  });
}

test('an unreadable package keeps its previous entry, with local fields re-read', async t => {
  const {report, carried} = dependentPair();
  mockPairFetch(t);
  const {catalog, state, carriedOver} = await collectEditorCatalog(report, {
    previous: {schemaVersion: 1, savedAt: 'before', published: [carried], failures: {}},
  });
  // Dropping @owner/b instead would make assembling @owner/a fail outright.
  assert.deepEqual(catalog.extensions.map(extension => extension.id), ['a', 'b']);
  assert.deepEqual(catalog.extensions[0].dependencies, ['b']);
  assert.equal(catalog.extensions[1].version, '1.0.0');
  assert.equal(catalog.extensions[1].category, 'data');
  assert.equal(catalog.extensions[1].docsURL, undefined);
  assert.deepEqual(carriedOver.map(({package: name, attempts}) => [name, attempts]), [['@owner/b', 1]]);
  assert.equal(state.failures['@owner/b'].attempts, 1);
  assert.equal(state.failures['@owner/b'].since, state.savedAt);
  assert.equal(state.published.length, 2);
});

test('the fallback is a grace period, not a permanent cover-up', async t => {
  const {report, carried} = dependentPair();
  mockPairFetch(t);
  const failures = {'@owner/b': {attempts: 3, error: 'HTTP 404', since: 'three runs ago'}};
  await assert.rejects(
    collectEditorCatalog(report, {previous: {schemaVersion: 1, savedAt: 'before', published: [carried], failures}}),
    /@owner\/b.*4 consecutive runs have failed since three runs ago/s,
  );

  // The same run succeeds while the package is still inside the grace period.
  const {carriedOver} = await collectEditorCatalog(report, {
    previous: {schemaVersion: 1, savedAt: 'before', published: [carried], failures},
    maxAttempts: 4,
  });
  assert.deepEqual(carriedOver.map(({attempts}) => attempts), [4]);
});

test('a package with nothing published before it fails has no fallback', async t => {
  const {report} = dependentPair();
  mockPairFetch(t);
  await assert.rejects(
    collectEditorCatalog(report, {previous: {schemaVersion: 1, savedAt: 'before', published: [], failures: {}}}),
    /@owner\/b.*nothing published previously/s,
  );
  await assert.rejects(collectEditorCatalog(report), /@owner\/b.*nothing published previously/s);
});

test('a recovered package clears its failure record', async t => {
  const {report, carried} = dependentPair();
  const base = 'https://cdn.jsdelivr.net/npm/@owner/b@1.0.0';
  const responses: Record<string, unknown> = {
    'https://cdn.jsdelivr.net/npm/@owner/a@1.2.3/package.json': {name: '@owner/a', version: '1.2.3'},
    'https://data.jsdelivr.com/v1/package/npm/@owner/a@1.2.3/flat': {files: [{name: '/dist/a.js'}]},
    'https://cdn.jsdelivr.net/npm/@owner/a@1.2.3/dist/a.js': '// ID: a\n// Name: A\n',
    [`${base}/package.json`]: {name: '@owner/b', version: '1.0.0'},
    'https://data.jsdelivr.com/v1/package/npm/@owner/b@1.0.0/flat': {files: [{name: '/dist/b.js'}]},
    [`${base}/dist/b.js`]: '// ID: b\n// Name: B\n',
  };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.ok(Object.hasOwn(responses, url), `Unexpected request ${url}`);
    const value = responses[url];
    return new Response(typeof value === 'string' ? value : JSON.stringify(value));
  });
  const {state, carriedOver} = await collectEditorCatalog(report, {
    previous: {schemaVersion: 1, savedAt: 'before', published: [carried],
      failures: {'@owner/b': {attempts: 2, error: 'HTTP 404', since: 'two runs ago'}}},
  });
  assert.deepEqual(carriedOver, []);
  assert.deepEqual(state.failures, {});
});
