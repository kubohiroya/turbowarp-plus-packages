import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categoryRelationships } from '../scripts/lib/relationships.ts';
import type { DashboardPackage, Dependency } from '../scripts/lib/types.ts';

function pkg(repo: string, category: string, dependencies: [string, Dependency['kind']][] = []): DashboardPackage {
  return {
    repo, category, label: repo, note: null, errors: [],
    manifest: { name: `@test/${repo}`, version: '1.0.0', private: false, license: null },
    dependencies: dependencies.map(([name, kind]) => ({
      name: `@test/${name}`, kind, range: '^1.0.0', family: true, local: false, stale: false,
    })),
  };
}

test('category diagrams resolve exact names and preserve incoming/outgoing kinds without inventing edges', () => {
  const packages = [
    pkg('one', 'focus', [['two', 'prod'], ['two', 'peer'], ['outside-b', 'optional'], ['unknown', 'prod']]),
    pkg('two', 'focus', [['outside-a', 'dev']]),
    pkg('outside-a', 'other', [['one', 'prod']]),
    pkg('outside-b', 'other', [['one', 'prod'], ['two', 'prod']]),
    pkg('unrelated', 'elsewhere'),
    { ...pkg('retired', 'other', [['one', 'prod']]), npm: { name: '@test/retired', published: true, deprecated: 'obsolete' } },
  ];
  const graph = categoryRelationships(packages, 'focus');
  assert.deepEqual(graph.primary.map((p) => p.repo), ['one', 'two']);
  assert.deepEqual(graph.internal, [{ source: 'one', target: 'two', kinds: ['prod', 'peer'] }]);
  assert.equal(graph.external.length, 1);
  const group = graph.external[0]!;
  assert.equal(group.category, 'other');
  assert.ok(!('representative' in group));
  assert.equal(group.incoming.length, 3);
  assert.equal(group.outgoing.length, 2);
  assert.deepEqual(group.outgoing.find((edge) => edge.source === 'two'), { source: 'two', target: 'outside-a', kinds: ['dev'] });
  assert.equal(graph.edges.length, 6);
  assert.ok(!graph.edges.some((edge) => /unknown|unrelated|retired/.test(edge.source + edge.target)));
  // Input collection is authoritative and must remain untouched.
  assert.equal(packages.length, 6);
  assert.equal(packages[0]!.dependencies!.length, 4);
});

test('external category relations are independent of report/declaration ordering', () => {
  const packages = [pkg('focus', 'focus', [['z', 'prod'], ['a', 'prod']]), pkg('z', 'other'), pkg('a', 'other')];
  assert.deepEqual(categoryRelationships(packages, 'focus').external,
    categoryRelationships([...packages].reverse(), 'focus').external);
});

test('isolated packages and empty categories have no external representatives or fabricated relations', () => {
  const packages = [pkg('alone', 'isolated'), pkg('other', 'other')];
  assert.deepEqual(categoryRelationships(packages, 'isolated').edges, []);
  assert.deepEqual(categoryRelationships(packages, 'isolated').external, []);
  assert.deepEqual(categoryRelationships(packages, 'missing').primary, []);
});

test('npm identity is supported when a manifest name is absent, regardless of the family flag', () => {
  const target = { ...pkg('target', 'other'), manifest: null, npm: { name: '@test/target', published: true } };
  const source = pkg('source', 'focus', [['target', 'prod']]);
  source.dependencies![0]!.family = false;
  assert.equal(categoryRelationships([source, target], 'focus').edges[0]!.target, 'target');
});

test('primary graph includes a verified build source and runtime edges; development remains optional', () => {
  const editor = pkg('editor', 'focus', [['data', 'dev']]);
  editor.buildDependencies = [{ repo: 'gui', revision: 'a'.repeat(40), sourceRevision: 'b'.repeat(40),
    sourcePath: 'site/source.json', contractPaths: ['scripts/site/source.mjs', 'scripts/site/build.mjs'] }];
  const gui = pkg('gui', 'focus', [['data', 'prod'], ['security', 'prod']]);
  gui.revision = { head: { oid: 'c'.repeat(40), committedDate: '2026-10-30' }, state: 'untagged', tag: null, release: null, aheadBy: null };
  const packages = [editor, gui, pkg('data', 'focus'), pkg('security', 'focus')];
  const primary = categoryRelationships(packages, 'focus', { includeDev: false });
  assert.deepEqual(primary.internal.map((edge) => [edge.source, edge.target, edge.kinds]), [
    ['editor', 'gui', ['build']], ['gui', 'data', ['prod']], ['gui', 'security', ['prod']],
  ]);
  const build = primary.internal[0]!.build!;
  assert.equal(build.revision, 'a'.repeat(40));
  assert.notEqual(build.revision, gui.revision.head!.oid);
  assert.equal(gui.revision.head!.oid, 'c'.repeat(40));
  assert.equal(categoryRelationships(packages, 'focus', { includeDev: true }).internal.length, 4);
});
