import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nestedFamilyDependencies, nestedManifestPaths } from '../scripts/lib/dependencies.ts';

const isFamily = (name: string) => name.startsWith('@kubohiroya/');

test('only source manifests below the root are inspected', () => {
  assert.deepEqual(nestedManifestPaths([
    'package.json', 'apps/camera-app/package.json', 'packages/app-extension/package.json',
    'node_modules/x/package.json', 'test/fixtures/a/package.json', 'tests/b/package.json', 'apps/camera-app/release.json',
  ]), ['apps/camera-app/package.json', 'packages/app-extension/package.json']);
});

test('a family version pinned below the root is reported with its location', () => {
  const problems = nestedFamilyDependencies([
    { path: 'apps/camera-app/package.json', text: JSON.stringify({ devDependencies: { '@kubohiroya/turbowarp-jsqr': '0.6.0', vite: '8.0.0' } }) },
    { path: 'packages/local-host/package.json', text: JSON.stringify({ dependencies: { typescript: '5.9.3' } }) },
  ], isFamily);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^apps\/camera-app\/package\.json: .*@kubohiroya\/turbowarp-jsqr@0\.6\.0$/u);
});

test('an unreadable nested manifest is reported instead of being skipped', () => {
  assert.deepEqual(nestedFamilyDependencies([{ path: 'a/package.json', text: '{' }], isFamily),
    ['a/package.json: package.json is not valid JSON']);
});
