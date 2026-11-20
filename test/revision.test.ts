import assert from 'node:assert/strict';
import { test } from 'node:test';
import { revisionStatus } from '../scripts/lib/revision.ts';
import type { RepositoryNode } from '../scripts/lib/types.ts';

const head = 'a'.repeat(40), parent = 'b'.repeat(40), historical = 'c'.repeat(40);
const fork = (): RepositoryNode => ({
  name: 'scratch-vm', description: null, url: 'https://github.com/test/scratch-vm', homepageUrl: null,
  isArchived: false, isPrivate: false, isFork: true, pushedAt: null, stargazerCount: 0,
  defaultBranchRef: { name: 'develop', target: { oid: head, committedDate: '2026-11-20T00:00:00Z' } },
  tags: { nodes: [{ name: '0.1.0', target: { oid: historical } }] },
  parent: { nameWithOwner: 'TurboWarp/scratch-vm', defaultBranchRef: { name: 'develop',
    target: { oid: parent, committedDate: '2026-11-19T00:00:00Z' } } },
});

test('a fork compares current upstream commits, not the inherited 2016 tag', async () => {
  const paths: string[] = [];
  const result = await revisionStatus('test', 'scratch-vm', fork(), async (path) => {
    paths.push(path); return { ahead_by: 8, behind_by: 0 };
  });
  assert.deepEqual(paths, [`/repos/test/scratch-vm/compare/${parent}...${head}`]);
  assert.equal(result.state, 'fork'); assert.equal(result.aheadBy, null);
  assert.equal(result.tag?.name, '0.1.0'); assert.equal(result.upstream?.aheadBy, 8);
});

test('an unchanged upstream mirror needs neither a release tag nor an API comparison', async () => {
  const node = fork(); node.defaultBranchRef!.target!.oid = parent; node.tags = { nodes: [] };
  const result = await revisionStatus('test', node.name, node, async () => { throw new Error('unexpected request'); });
  assert.equal(result.state, 'fork'); assert.equal(result.upstream?.aheadBy, 0);
  assert.equal(result.upstream?.behindBy, 0);
});

test('a diverged fork retains both directions of the comparison', async () => {
  const result = await revisionStatus('test', 'scratch-vm', fork(), async () => ({ ahead_by: 8, behind_by: 3 }));
  assert.equal(result.upstream?.aheadBy, 8); assert.equal(result.upstream?.behindBy, 3);
});

for (const value of [null, { ahead_by: -1, behind_by: 0 }, { ahead_by: 8 }]) {
  test(`incomplete fork comparison ${JSON.stringify(value)} stays unknown`, async () => {
    const result = await revisionStatus('test', 'scratch-vm', fork(), async () => value);
    assert.equal(result.state, 'fork'); assert.equal(result.upstream?.aheadBy, null);
    assert.equal(result.aheadBy, null);
  });
}

test('comparison failure never substitutes the historical tag count', async () => {
  const result = await revisionStatus('test', 'scratch-vm', fork(), async () => { throw new Error('HTTP 503'); });
  assert.equal(result.state, 'fork'); assert.equal(result.upstream?.aheadBy, null);
});

test('missing parent metadata stays a fork with an unknown comparison', async () => {
  const node = fork(); node.parent = null;
  const result = await revisionStatus('test', node.name, node, async () => { throw new Error('unexpected request'); });
  assert.equal(result.state, 'fork'); assert.equal(result.upstream, undefined);
});

test('ordinary packages still compare the package release tag', async () => {
  const node = fork(); node.isFork = false; const paths: string[] = [];
  const result = await revisionStatus('test', node.name, node, async (path) => {
    paths.push(path); return { ahead_by: 2 };
  });
  assert.equal(result.state, 'unreleased'); assert.equal(result.aheadBy, 2);
  assert.deepEqual(paths, [`/repos/test/scratch-vm/compare/0.1.0...${head}`]);
});
