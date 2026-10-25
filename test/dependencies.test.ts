import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  declaredDependencies,
  evaluateRange,
  isLocalRange,
} from '../scripts/lib/dependencies.ts';

const LOCAL = ['file:', 'link:', 'workspace:', 'portal:', 'patch:'];
const versions = ['0.1.0', '0.2.0', '1.0.0', '1.1.0', '1.2.0-rc.1'];

test('local protocols are recognised', () => {
  for (const range of ['file:../pkg', 'link:../pkg', 'workspace:^', '../pkg', './pkg', '/abs/pkg']) {
    assert.equal(isLocalRange(range, LOCAL), true, range);
  }
  for (const range of ['^1.0.0', '1.2.3', '*', '>=1 <2']) {
    assert.equal(isLocalRange(range, LOCAL), false, range);
  }
});

test('a local range is reported as local, never as stale', () => {
  const result = evaluateRange({ range: 'workspace:^', versions, localProtocols: LOCAL });
  assert.equal(result.local, true);
  assert.equal(result.stale, false);
});

test('a range that covers the newest version is current', () => {
  const result = evaluateRange({ range: '^1.0.0', versions, localProtocols: LOCAL });
  assert.equal(result.stale, false);
  assert.equal(result.latest, '1.1.0');
  assert.equal(result.wanted, '1.1.0');
});

test('a range left behind the newest version is stale, with the size of the gap', () => {
  const result = evaluateRange({ range: '0.1.0', versions, localProtocols: LOCAL });
  assert.equal(result.stale, true);
  assert.equal(result.latest, '1.1.0');
  assert.equal(result.wanted, '0.1.0');
  assert.equal(result.behind, 'major');
});

test('prereleases do not count as the newest published version', () => {
  const result = evaluateRange({ range: '^1.1.0', versions, localProtocols: LOCAL });
  assert.equal(result.latest, '1.1.0');
  assert.equal(result.stale, false);
});

test('ranges semver cannot reason about are flagged rather than guessed at', () => {
  for (const range of ['github:kubohiroya/pkg', 'git+https://example.com/p.git', 'npm:other@^1']) {
    const result = evaluateRange({ range, versions, localProtocols: LOCAL });
    assert.equal(result.unresolvable, true, range);
    assert.equal(result.stale, false, range);
  }
});

test('a package missing from the registry is flagged, not treated as current', () => {
  const result = evaluateRange({ range: '^1.0.0', versions: null, localProtocols: LOCAL });
  assert.equal(result.missing, true);
  assert.equal(result.stale, false);
});

test('dev dependencies are kept only when they are one of ours', () => {
  const manifest = {
    dependencies: { three: '^0.160.0' },
    peerDependencies: { '@scope/runtime': '^1' },
    devDependencies: { vitest: '^2', '@scope/toolchain': '^3' },
  };
  const declared = declaredDependencies(manifest, (name) => name.startsWith('@scope/'));

  assert.deepEqual(
    declared.map((d) => `${d.name}:${d.kind}`).sort(),
    ['@scope/runtime:peer', '@scope/toolchain:dev', 'three:prod'],
  );
});
