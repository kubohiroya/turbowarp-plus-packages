import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { effectiveUpdates, onlyDependencyUpdate, samePublishedContent } from '../scripts/lib/release-unneeded.ts';
import { fixture } from './release-execution.test.ts';

async function unpacked(root: string, name: string, manifest: object, files: Record<string, string>) {
  const directory = join(root, name);
  await mkdir(join(directory, 'dist'), { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2));
  for (const [file, text] of Object.entries(files)) await writeFile(join(directory, file), text);
  return directory;
}

test('a package whose consumers get the same files and manifest is unchanged from its publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-unneeded-'));
  try {
    const published = await unpacked(root, 'published', { name: 'a', version: '1.0.0', dependencies: { b: '^1.0.0' }, devDependencies: { c: '^1.0.0' } }, { 'dist/index.js': 'x' });
    const devOnly = await unpacked(root, 'dev-only', { name: 'a', version: '1.1.0', dependencies: { b: '^1.0.0' }, devDependencies: { c: '^2.0.0' } }, { 'dist/index.js': 'x' });
    assert.equal(await samePublishedContent(devOnly, published), true);
    const runtime = await unpacked(root, 'runtime', { name: 'a', version: '1.1.0', dependencies: { b: '^2.0.0' }, devDependencies: { c: '^1.0.0' } }, { 'dist/index.js': 'x' });
    assert.equal(await samePublishedContent(runtime, published), false);
    const bundled = await unpacked(root, 'bundled', { name: 'a', version: '1.1.0', dependencies: { b: '^1.0.0' }, devDependencies: { c: '^2.0.0' } }, { 'dist/index.js': 'y' });
    assert.equal(await samePublishedContent(bundled, published), false);
    const extra = await unpacked(root, 'extra', { name: 'a', version: '1.1.0', dependencies: { b: '^1.0.0' } }, { 'dist/index.js': 'x', 'dist/more.js': '' });
    assert.equal(await samePublishedContent(extra, published), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('only steps brought in by a dependency update can be cancelled, and cancelled upstream updates are dropped', () => {
  const [upstream, downstream] = fixture().plan.steps;
  assert.equal(onlyDependencyUpdate(upstream), false);
  assert.equal(onlyDependencyUpdate({ ...downstream, reasons: ['dependency-update'] }), true);
  assert.equal(onlyDependencyUpdate({ ...downstream, reasons: ['dependency-update', 'commits-ahead'] }), false);
  assert.equal(effectiveUpdates(downstream, new Set()).length, 1);
  assert.deepEqual(effectiveUpdates(downstream, new Set(['upstream'])), []);
  const published = { ...downstream.dependencyUpdates[0], source: 'published' as const };
  assert.equal(effectiveUpdates({ ...downstream, dependencyUpdates: [published] }, new Set(['upstream'])).length, 1);
});
