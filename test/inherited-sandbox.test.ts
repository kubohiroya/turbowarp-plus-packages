import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inheritedUnsandboxedRequirements } from '../scripts/lib/sandbox.ts';
import type { DashboardPackage, Dependency, UnsandboxedRequirement } from '../scripts/lib/types.ts';

const dependency = (repo: string, kind: Dependency['kind'] = 'prod'): Dependency => ({
  name: `@test/${repo}`, range: '*', kind, family: true, local: false, stale: false,
});
const pkg = (
  repo: string, category: string, dependencies: Dependency[] = [], unsandboxed?: UnsandboxedRequirement,
): DashboardPackage => ({ repo, label: repo, category, dependencies, unsandboxed, note: null, errors: [] });
const catalog = (packages: DashboardPackage[]) => new Map(packages.map(p => [`@test/${p.repo}`, p.repo]));

test('apps inherit required declarations through shared and cyclic dependency paths', () => {
  const packages = [
    pkg('app-a', 'apps', [dependency('bridge-a'), dependency('required-z')]),
    pkg('app-b', 'apps', [dependency('bridge-b')]),
    pkg('bridge-a', 'contracts', [dependency('bridge-b'), dependency('required-z')]),
    pkg('bridge-b', 'contracts', [dependency('bridge-a'), dependency('required-a')]),
    pkg('required-z', 'data', [], 'required'),
    pkg('required-a', 'data', [], 'required'),
  ];
  const before = JSON.stringify(packages);
  const result = inheritedUnsandboxedRequirements(packages, catalog(packages));
  assert.deepEqual([...result], [
    ['app-a', ['required-a', 'required-z']],
    ['app-b', ['required-a', 'required-z']],
  ]);
  assert.equal(JSON.stringify(packages), before);
  assert.deepEqual([...inheritedUnsandboxedRequirements([...packages].reverse(), catalog(packages)).get('app-a')!], ['required-a', 'required-z']);
});

test('includes direct prod, peer, optional and bundled development extensions', () => {
  const packages = [
    ...(['prod', 'peer', 'optional', 'dev'] as const).map(kind =>
      pkg(`app-${kind}`, 'apps', [dependency('extension', kind)])),
    pkg('extension', 'media', [], 'required'),
  ];
  const result = inheritedUnsandboxedRequirements(packages, catalog(packages));
  for (const kind of ['prod', 'peer', 'optional', 'dev']) {
    assert.deepEqual(result.get(`app-${kind}`), ['extension']);
  }
});

test('resolves catalog npm aliases and ignores external or absent repositories', () => {
  const packages = [
    pkg('app', 'apps', [dependency('alias'), dependency('missing'), { ...dependency('external'), family: false }]),
    pkg('actual-repo', 'data', [], 'required'),
    pkg('external', 'data', [], 'required'),
  ];
  const names = catalog(packages);
  names.set('@test/alias', 'actual-repo');
  names.set('@test/missing', 'not-collected');
  assert.deepEqual(inheritedUnsandboxedRequirements(packages, names).get('app'), ['actual-repo']);
});

test('does not inherit development dependencies of intermediate libraries', () => {
  const packages = [
    pkg('app', 'apps', [dependency('library')]),
    pkg('library', 'contracts', [dependency('test-extension', 'dev'), dependency('runtime-extension', 'peer')]),
    pkg('test-extension', 'data', [], 'required'),
    pkg('runtime-extension', 'data', [], 'required'),
  ];
  assert.deepEqual(inheritedUnsandboxedRequirements(packages, catalog(packages)).get('app'), ['runtime-extension']);
});

test('does not turn optional, not-needed, unknown or missing declarations into required', () => {
  const packages = [
    pkg('app', 'apps', ['optional', 'not-needed', 'unknown', 'missing'].map(repo => dependency(repo))),
    ...(['optional', 'not-needed', 'unknown'] as const).map(state => pkg(state, 'data', [], state)),
    pkg('missing', 'contracts'),
    pkg('empty-app', 'apps'),
    pkg('cycle-a', 'apps', [dependency('cycle-b')]),
    pkg('cycle-b', 'apps', [dependency('cycle-a')]),
  ];
  assert.equal(inheritedUnsandboxedRequirements(packages, catalog(packages)).size, 0);
});

test('extensions inherit required declarations through libraries and cycles without changing their own declarations', () => {
  const packages = [
    ...(['optional', 'not-needed', 'unknown'] as const).map(state =>
      pkg(`extension-${state}`, 'data', [dependency('bridge')], state)),
    pkg('bridge', 'contracts', [dependency('extension-unknown'), dependency('source')]),
    pkg('source', 'sensing', [], 'required'),
  ];
  const before = JSON.stringify(packages);
  const result = inheritedUnsandboxedRequirements(packages, catalog(packages));
  for (const state of ['optional', 'not-needed', 'unknown']) {
    assert.deepEqual(result.get(`extension-${state}`), ['source']);
  }
  assert.equal(result.has('bridge'), false);
  assert.equal(result.has('source'), false);
  assert.equal(JSON.stringify(packages), before);
});

test('extensions inherit runtime requirements but ignore their development-only requirements', () => {
  const packages = [
    pkg('extension', 'data', [dependency('runtime-source'), dependency('dev-source', 'dev')], 'not-needed'),
    pkg('runtime-source', 'data', [], 'required'),
    pkg('dev-source', 'data', [], 'required'),
  ];
  assert.deepEqual(inheritedUnsandboxedRequirements(packages, catalog(packages)).get('extension'), ['runtime-source']);
});
