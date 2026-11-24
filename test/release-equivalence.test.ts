import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { artifactDifferences } from '../scripts/lib/release-equivalence.ts';

async function tree(root: string, files: Record<string, string | Buffer>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

const manifest = (version: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  name: '@family/ext', version, gitHead: version === '1.0.0' ? 'a'.repeat(40) : 'b'.repeat(40),
  dependencies: { '@family/runtime': '^2.0.0' }, devDependencies: { '@family/editor': `^0.11.${version === '1.0.0' ? 4 : 5}` },
  ...extra,
}, null, 2);

async function compare(published: Record<string, string | Buffer>, candidate: Record<string, string | Buffer>) {
  const root = await mkdtemp(join(tmpdir(), 'equivalence-'));
  try {
    await tree(join(root, 'published'), published);
    await tree(join(root, 'candidate'), candidate);
    return await artifactDifferences(join(root, 'published'), join(root, 'candidate'), { published: '1.0.0', candidate: '1.0.1' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const bundle = (version: string, editor: string) =>
  `// Version: ${version}\n//#region node_modules/.pnpm/@family+editor@${editor}_react@18.3.1/node_modules/@family/editor/dist/schema.js\nexport const run = () => 1;\n`;

test('a rebuild that differs only in its own version, store paths, dev ranges and docs is the same artifact', async () => {
  assert.deepEqual(await compare({
    'package.json': manifest('1.0.0'),
    'dist/ext.js': bundle('1.0.0', '0.11.4'),
    'README.md': 'npm i @family/ext@1.0.0',
    'CHANGELOG.md': '## 1.0.0',
    'docs/index.html': '<p>backed by SVG Text 0.17.0</p>',
    'dist/icon.png': Buffer.from([0x89, 0, 1, 2]),
  }, {
    'package.json': manifest('1.0.1'),
    'dist/ext.js': bundle('1.0.1', '0.11.5'),
    'README.md': 'npm i @family/ext@1.0.1',
    'CHANGELOG.md': '## 1.0.1\n\n- family依存を更新\n\n## 1.0.0',
    'docs/index.html': '<p>backed by SVG Text 0.17.1</p>',
    'dist/icon.png': Buffer.from([0x89, 0, 1, 2]),
  }), []);
});

test('changed code, files, user-facing ranges or binaries are differences', async () => {
  const base = { 'package.json': manifest('1.0.0'), 'dist/ext.js': bundle('1.0.0', '0.11.4'), 'dist/icon.png': Buffer.from([0, 1]) };
  assert.deepEqual(await compare(base, { ...base, 'package.json': manifest('1.0.1'),
    'dist/ext.js': bundle('1.0.1', '0.11.5').replace('=> 1', '=> 2') }), ['changed dist/ext.js']);
  assert.deepEqual(await compare(base, { ...base, 'package.json': manifest('1.0.1', { dependencies: { '@family/runtime': '^2.1.0' } }),
    'dist/ext.js': bundle('1.0.1', '0.11.4') }), ['changed package.json']);
  assert.deepEqual(await compare(base, { ...base, 'package.json': manifest('1.0.1'), 'dist/ext.js': bundle('1.0.1', '0.11.4'),
    'dist/icon.png': Buffer.from([0, 2]) }), ['changed dist/icon.png']);
  assert.deepEqual(await compare(base, { 'package.json': manifest('1.0.1'), 'dist/ext.js': bundle('1.0.1', '0.11.4'),
    'dist/extra.js': 'x' }), ['added dist/extra.js', 'removed dist/icon.png']);
});

test('an embedded dependency range is a difference, not normalised away', async () => {
  const embed = (range: string, version: string) => `const deps = {"@family/camera": "${range}"}; // ${version}`;
  assert.deepEqual(await compare(
    { 'package.json': manifest('1.0.0'), 'dist/ext.js': embed('^0.25.0', '1.0.0') },
    { 'package.json': manifest('1.0.1'), 'dist/ext.js': embed('^0.25.1', '1.0.1') },
  ), ['changed dist/ext.js']);
});
