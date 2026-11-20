import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishedExtension} from '../scripts/lib/extension-catalog.ts';
import {catalogResourceDisplays} from '../scripts/lib/resource-display.ts';
import type {DashboardPackage} from '../scripts/lib/types.ts';

const declaration = {schemaVersion: 1, resources: [
  {type: 'network', usage: 'conditional', purpose: {en: 'Download <model>', ja: 'モデルを取得'},
    condition: {en: 'When loading a URL', ja: 'URLから読み込む場合'},
    data: {direction: 'download', content: {en: 'Model weights', ja: 'モデルの重み'}}}
]};

test('the catalog transports the published package declaration, including reviewed empty, without executing JavaScript', async t => {
  const base = 'https://cdn.jsdelivr.net/npm/@owner/a@1.2.3';
  let resourceDeclaration: unknown = declaration;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const responses: Record<string, unknown> = {
      [`${base}/package.json`]: {name: '@owner/a', version: '1.2.3', turbowarpExtension: {resourceDeclaration}},
      'https://data.jsdelivr.com/v1/package/npm/@owner/a@1.2.3/flat': {files: [{name: '/dist/a.js'}]},
      [`${base}/dist/a.js`]: '// ID: a\n// Name: A\nthrow new Error("must not execute");'
    };
    assert.ok(Object.hasOwn(responses, url), `Unexpected request ${url}`);
    const value = responses[url];
    return new Response(typeof value === 'string' ? value : JSON.stringify(value));
  });
  const pkg = {repo: 'a', npm: {name: '@owner/a', latest: '1.2.3'}, github: {url: 'https://github.com/owner/a'}} as DashboardPackage;
  assert.deepEqual((await publishedExtension(pkg)).entry.resourceDeclaration, declaration);
  resourceDeclaration = {schemaVersion: 1, resources: []};
  assert.deepEqual((await publishedExtension(pkg)).entry.resourceDeclaration, resourceDeclaration);
  resourceDeclaration = undefined;
  assert.equal(Object.hasOwn((await publishedExtension(pkg)).entry, 'resourceDeclaration'), false);
  resourceDeclaration = {schemaVersion: 999, resources: []};
  await assert.rejects(publishedExtension(pkg), /unsupported schemaVersion/);
});

test('dashboard uses the public catalog version, escaped bilingual details, and accessible vector icons', () => {
  const display = catalogResourceDisplays({schemaVersion: 1, extensions: [
    {package: '@owner/a', version: '1.2.3', resourceDeclaration: declaration},
    {package: '@owner/empty', version: '2', resourceDeclaration: {schemaVersion: 1, resources: []}},
    {package: '@owner/old', version: '1'},
    {package: '@owner/bad', version: '1', resourceDeclaration: {schemaVersion: 2, resources: []}}
  ]});
  assert.equal(display.get('@owner/a')?.version, '1.2.3');
  const html = display.get('@owner/a')!.html;
  assert.match(html, /data-resource-version="1.2.3"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /Network/);
  assert.match(html, /ネットワーク/);
  assert.match(html, /Download &lt;model&gt;/);
  assert.doesNotMatch(html, /<model>/);
  assert.match(html, /モデルの重み/);
  assert.match(display.get('@owner/empty')!.html, /申告：なし/);
  assert.match(display.get('@owner/old')!.html, /未申告/);
  assert.match(display.get('@owner/bad')!.html, /読み取れません/);
});
