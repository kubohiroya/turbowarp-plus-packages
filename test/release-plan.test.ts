import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createReleasePlan, formatReleasePlan } from '../scripts/lib/release-plan.ts';
import type { DashboardPackage, DashboardReport, Dependency } from '../scripts/lib/types.ts';

function pkg(repo: string, changes: Partial<DashboardPackage> = {}): DashboardPackage {
  return {
    repo, label: repo, category: 'test', note: null, errors: [],
    manifest: { name: `@family/${repo}`, version: '1.2.3', private: false, license: null },
    npm: { name: `@family/${repo}`, published: true, latest: '1.2.3', versions: ['1.2.3'] },
    revision: {
      state: 'released', head: { oid: `head-${repo}`, committedDate: '2026-10-25T00:00:00Z' },
      tag: { name: 'v1.2.3', oid: `head-${repo}`, committedDate: null },
      release: null, aheadBy: 0,
    },
    dependencies: [], ...changes,
  };
}

function ahead(repo: string, changes: Partial<DashboardPackage> = {}): DashboardPackage {
  const result = pkg(repo, changes);
  result.revision = { ...result.revision!, state: 'unreleased', aheadBy: 2,
    tag: { name: 'v1.2.3', oid: `old-${repo}`, committedDate: null } };
  return result;
}

function dep(repo: string, range = '1.2.3', kind: Dependency['kind'] = 'prod'): Dependency {
  return { name: `@family/${repo}`, range, kind, family: true, local: false, stale: false };
}

function report(...packages: DashboardPackage[]): DashboardReport {
  return { generatedAt: '2026-10-25T00:00:00Z', owner: 'family', scope: '@family',
    site: {}, categories: [], packages };
}

test('postorder traverses the upstream closure once and propagates planned versions through a diamond', () => {
  const input = report(pkg('a', { dependencies: [dep('c'), dep('b')] }),
    pkg('b', { dependencies: [dep('d')] }), pkg('c', { dependencies: [dep('d')] }),
    ahead('d'), ahead('unrelated'));
  const before = JSON.stringify(input);
  const plan = createReleasePlan(input, '@family/a');
  assert.deepEqual(plan.order, ['d', 'b', 'c', 'a']);
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.steps.map(s => s.nextVersion), ['1.3.0', '1.3.0', '1.3.0', '1.3.0']);
  assert.equal(plan.steps[3].dependencyUpdates.length, 2);
  assert.equal(plan.steps[3].versionChange, 'minor');
  assert(plan.steps[3].dependencyUpdates.every(update => update.source === 'planned'));
  assert.deepEqual(plan.publishTargets.map(p => p.name), ['@family/d', '@family/b', '@family/c', '@family/a']);
  assert.equal(plan.publishTargets[0].headSha, 'head-d');
  assert.equal(plan.publishTargets[0].tag, 'v1.3.0');
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(createReleasePlan(input, 'a'), plan);
  assert.equal(plan.snapshot.sha256.length, 64);
  input.packages[3].revision!.head!.oid = 'new-head';
  assert.notEqual(createReleasePlan(input, 'a').snapshot.sha256, plan.snapshot.sha256);
});

test('an unchanged closure produces no releases or bumps', () => {
  const plan = createReleasePlan(report(pkg('a', { dependencies: [dep('b')] }), pkg('b')), 'a');
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.publishTargets, []);
  assert(plan.steps.every(step => step.action === 'none' && step.nextVersion === null));
});

test('published upstream updates preserve exact, caret and tilde dependency styles, including dev and optional', () => {
  const input = report(pkg('a', { dependencies: [dep('b', '1.0.0'), dep('b', '^1.0.0', 'dev'),
    dep('b', '~1.0.0', 'optional')] }), pkg('b'));
  const plan = createReleasePlan(input, 'a');
  assert.deepEqual(plan.steps[1].dependencyUpdates.map(u => [u.field, u.to, u.source]), [
    ['dependencies', '1.2.3', 'published'], ['devDependencies', '^1.2.3', 'published'],
    ['optionalDependencies', '~1.2.3', 'published'],
  ]);
  assert.equal(plan.steps[0].action, 'none');
  assert.equal(plan.steps[1].nextVersion, '1.3.0');
});

test('compatible broad and peer ranges remain unchanged; external dependencies are not traversed', () => {
  const external = { ...dep('not-in-catalog', '^1'), family: false, stale: true };
  const plan = createReleasePlan(report(pkg('a', { dependencies: [dep('b', '>=1 <2'),
    dep('b', '^1.0.0', 'peer'), external] }), pkg('b')), 'a');
  assert.deepEqual(plan.order, ['b', 'a']);
  assert.deepEqual(plan.publishTargets, []);
  assert.deepEqual(plan.steps[1].dependencyUpdates, []);
});

test('incompatible peer updates are concrete proposals and propagate without enabling apply', () => {
  const plan = createReleasePlan(report(pkg('root', { dependencies: [dep('a')] }),
    pkg('a', { dependencies: [dep('b', '0.9.0', 'peer')] }), pkg('b')), 'root');
  assert.equal(plan.ready, true);
  assert.equal(plan.applyReady, false);
  assert.equal(plan.steps[1].dependencyUpdates[0].to, '1.2.3');
  assert.equal(plan.steps[1].dependencyUpdates[0].targetVersion, '1.2.3');
  assert.equal(plan.steps[1].dependencyUpdates[0].field, 'peerDependencies');
  assert(plan.steps[1].issues.some(i => i.code === 'peer-compatibility' && i.requiresReview));
  assert.equal(plan.steps[2].dependencyUpdates[0].to, '1.3.0');
  assert.equal(plan.publishTargets.length, 2);
  assert.match(formatReleasePlan(plan), /レビュー必要: 1件/);
});

test('git, workspace, alias and unsupported complex ranges are never silently replaced', () => {
  for (const range of ['git+https://example.com/b.git#abc', 'workspace:*', 'npm:other@1', '>=0.1 <1',
    '01.2.3', '^9007199254740992.0.0']) {
    const plan = createReleasePlan(report(pkg('a', { dependencies: [dep('b', range)] }), pkg('b')), 'a');
    assert.equal(plan.ready, false, range);
    assert.equal(plan.steps[1].dependencyUpdates[0].to, null, range);
    assert.equal(plan.steps[1].dependencyUpdates[0].from, range);
  }
});

test('peer proposals preserve simple styles or extend complex ranges without claiming compatibility', () => {
  for (const [range, to] of [['0.9.0', '1.2.3'], ['^0.9.0', '^1.2.3'], ['~0.9.0', '~1.2.3'],
    ['>=0.1 <1', '>=0.1 <1 || 1.2.3']]) {
    const plan = createReleasePlan(report(pkg('a', { dependencies: [dep('b', range, 'peer')] }), pkg('b')), 'a');
    assert.equal(plan.ready, true, range);
    assert.equal(plan.applyReady, false);
    assert.equal(plan.steps[1].dependencyUpdates[0].to, to);
    assert(plan.steps[1].issues.some(i => i.requiresReview && /互換性は未検証/.test(i.message)));
  }
});

test('only Git references to the recorded family repository get an npm replacement proposal', () => {
  for (const [range, ready] of [
    ['git+https://github.com/family/b.git#abc', true],
    ['git+ssh://git@github.com/family/b.git#abc', true],
    ['git+https://github.com/other/b.git#abc', false],
    ['git+https://github.com/family/other.git#abc', false],
    ['git+https://github.com.example.com/family/b.git#abc', false],
  ] as const) {
    const plan = createReleasePlan(report(pkg('a', { dependencies: [dep('b', range)] }), pkg('b')), 'a');
    assert.equal(plan.ready, ready, range);
    assert.equal(plan.applyReady, false);
    assert.equal(plan.steps[1].dependencyUpdates[0].to, ready ? '1.2.3' : null);
    if (ready) assert(plan.steps[1].issues.some(i => i.code === 'git-to-npm' && i.requiresReview));
  }
});

test('RC updates reuse prepared versions, otherwise advance the same series and skip occupied numbers', () => {
  for (const [current, published, versions, next, change] of [
    ['4.0.0-rc.56', '4.0.0-rc.49', ['4.0.0-rc.49', '4.0.0-rc.53'], '4.0.0-rc.56', 'prepared'],
    ['4.0.0-rc.49', '4.0.0-rc.49', ['4.0.0-rc.49', '4.0.0-rc.50'], '4.0.0-rc.51', 'prerelease'],
  ] as const) {
    const node = ahead('a', {
      manifest: { ...pkg('a').manifest!, version: current },
      npm: { name: '@family/a', published: true, latest: published, versions: [...versions] },
    });
    node.revision!.tag!.name = `v${published}`;
    const plan = createReleasePlan(report(node), 'a');
    assert.equal(plan.ready, true);
    assert.equal(plan.applyReady, false);
    assert.equal(plan.steps[0].nextVersion, next);
    assert.equal(plan.steps[0].versionChange, change);
    assert(plan.steps[0].issues.some(i => i.code === 'prerelease-channel' && i.requiresReview));
  }
  const initial = pkg('a', { manifest: { ...pkg('a').manifest!, version: '4.0.0-rc.1' },
    npm: { name: '@family/a', published: false } });
  assert.equal(createReleasePlan(report(initial), 'a').steps[0].nextVersion, '4.0.0-rc.1');
  const olderRC = ahead('a', { manifest: { ...pkg('a').manifest!, version: '1.2.3-rc.1' } });
  const blocked = createReleasePlan(report(olderRC), 'a');
  assert.equal(blocked.ready, false);
  assert(blocked.steps[0].issues.some(i => i.code === 'prerelease-series'));
});

test('a newer declared dependency is never downgraded to the snapshot version', () => {
  const plan = createReleasePlan(report(pkg('a', { dependencies: [dep('b', '2.0.0')] }), pkg('b')), 'a');
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.steps[1].dependencyUpdates, []);
  assert(plan.steps[1].issues.some(i => i.code === 'dependency-ahead'));
});

test('an already prepared unpublished version is reused and propagated without another bump', () => {
  const prepared = ahead('b', { manifest: { ...pkg('b').manifest!, version: '1.3.0' } });
  const plan = createReleasePlan(report(pkg('a', { dependencies: [dep('b')] }), prepared), 'a');
  assert.equal(plan.steps[0].nextVersion, '1.3.0');
  assert.equal(plan.steps[0].versionChange, 'prepared');
  assert.equal(plan.steps[1].dependencyUpdates[0].to, '1.3.0');
});

test('a prepared version already tagged at HEAD can complete its missing npm publication', () => {
  const node = pkg('a', { manifest: { ...pkg('a').manifest!, version: '1.3.0' } });
  node.revision!.tag!.name = 'v1.3.0';
  const plan = createReleasePlan(report(node), 'a');
  assert.equal(plan.ready, true);
  assert.equal(plan.steps[0].versionChange, 'prepared');
  assert.equal(plan.publishTargets[0].version, '1.3.0');
});

test('minor bumps start above the published version and skip already occupied versions', () => {
  const node = ahead('a', {
    npm: { name: '@family/a', published: true, latest: '1.4.0', versions: ['1.2.3', '1.4.0', '1.5.0'] },
  });
  node.revision!.tag!.name = 'v1.4.0';
  const plan = createReleasePlan(report(node), 'a');
  assert.equal(plan.steps[0].nextVersion, '1.6.0');
  assert.equal(plan.steps[0].versionChange, 'minor');
  assert.equal(plan.steps[0].sourceChanges, 'ahead');
  assert.equal(plan.ready, true);
});

test('first publication uses the existing version and private or non-npm projects are update-only', () => {
  const unpublished = ahead('b', { npm: { name: '@family/b', published: false } });
  const plan = createReleasePlan(report(pkg('a', { dependencies: [dep('b', '1.0.0')] }), unpublished), 'a');
  assert.equal(plan.steps[0].nextVersion, '1.2.3');
  assert.equal(plan.steps[0].versionChange, 'initial');
  for (const changes of [
    { manifest: { ...pkg('a').manifest!, private: true } },
    { npm: { name: null, published: false, notAPackage: true } },
  ]) {
    const privatePlan = createReleasePlan(report(ahead('a', changes)), 'a');
    assert.equal(privatePlan.steps[0].action, 'update-only');
    assert.deepEqual(privatePlan.publishTargets, []);
  }
});

test('non-npm upstreams without a usable registry version block dependency updates', () => {
  const plan = createReleasePlan(report(pkg('a', { dependencies: [dep('b')] }),
    ahead('b', { npm: { name: null, published: false, notAPackage: true } })), 'a');
  assert.equal(plan.steps[1].action, 'blocked');
  assert(plan.steps[1].issues.some(i => i.code === 'upstream-unavailable'));
});

test('untagged and prerelease states remain explicit instead of implying publication parity', () => {
  const untagged = pkg('a', { revision: { ...pkg('a').revision!, tag: null, state: 'untagged' } });
  const plan = createReleasePlan(report(untagged), 'a');
  assert.equal(plan.steps[0].nextVersion, null);
  assert.equal(plan.ready, true);
  assert.equal(plan.steps[0].sourceChanges, 'unknown');
  assert(plan.steps[0].issues.some(i => i.code === 'publication-baseline' && i.severity === 'warning'));
  const prerelease = createReleasePlan(report(ahead('a', {
    manifest: { ...pkg('a').manifest!, version: '2.0.0-rc.1' },
  })), 'a');
  assert.equal(prerelease.ready, true);
  assert.equal(prerelease.applyReady, false);
  assert.equal(prerelease.steps[0].nextVersion, '2.0.0-rc.1');
  assert.equal(prerelease.steps[0].versionChange, 'prepared');
});

test('an untagged upstream supplies its published version without blocking the dependent', () => {
  const upstream = pkg('b', { revision: { ...pkg('b').revision!, tag: null, state: 'untagged' } });
  const plan = createReleasePlan(report(pkg('a', { dependencies: [dep('b', '1.0.0')] }), upstream), 'a');
  assert.equal(plan.ready, true);
  assert.equal(plan.steps[0].action, 'none');
  assert.equal(plan.steps[0].sourceChanges, 'unknown');
  assert.equal(plan.steps[0].nextVersion, null);
  assert(plan.steps[0].issues.some(i => i.code === 'publication-baseline' && i.severity === 'warning'));
  assert.equal(plan.steps[1].action, 'publish');
  assert.equal(plan.steps[1].dependencyUpdates[0].to, '1.2.3');
  assert.equal(plan.steps[1].dependencyUpdates[0].source, 'published');
  assert.deepEqual(plan.publishTargets.map(t => t.name), ['@family/a']);
});

test('mismatched, arbitrary and SHA-less tags do not establish unpublished source changes', () => {
  for (const tagName of ['v1.0.0', 'build-1.2.3', 'v1.2.3']) {
    const node = ahead('a');
    node.revision!.tag!.name = tagName;
    if (tagName === 'v1.2.3') node.revision!.tag!.oid = null;
    const plan = createReleasePlan(report(node), 'a');
    assert.equal(plan.ready, true, tagName);
    assert.equal(plan.steps[0].sourceChanges, 'unknown', tagName);
    assert.equal(plan.steps[0].nextVersion, null, tagName);
    assert(!plan.steps[0].reasons.includes('commits-ahead'), tagName);
    assert.deepEqual(plan.publishTargets, []);
  }
});

test('known dependency edits still justify one minor bump when the source baseline is unknown', () => {
  for (const tag of [null, { name: 'v1.0.0', oid: 'old-a', committedDate: null }]) {
    const node = ahead('a', { dependencies: [dep('b', '1.0.0')] });
    node.revision!.tag = tag;
    const plan = createReleasePlan(report(node, pkg('b')), 'a');
    assert.equal(plan.ready, true);
    assert.equal(plan.steps[1].sourceChanges, 'unknown');
    assert.deepEqual(plan.steps[1].reasons, ['dependency-update']);
    assert.equal(plan.steps[1].nextVersion, '1.3.0');
    assert.equal(plan.publishTargets[0].name, '@family/a');
    assert(plan.steps[1].issues.some(i => i.severity === 'warning'));
  }
});

test('source uncertainty does not weaken collection-error blockers or their propagation', () => {
  const node = pkg('b', { errors: ['collection failed'],
    revision: { ...pkg('b').revision!, tag: null, state: 'untagged' } });
  const plan = createReleasePlan(report(pkg('a', { dependencies: [dep('b')] }), node), 'a');
  assert.equal(plan.ready, false);
  assert(plan.steps[0].issues.some(i => i.code === 'collection-error' && i.severity === 'blocker'));
  assert(plan.steps[0].issues.some(i => i.code === 'publication-baseline' && i.severity === 'warning'));
  assert(plan.steps[1].issues.some(i => i.code === 'upstream-blocked'));
  assert.deepEqual(plan.publishTargets, []);
});

test('human output distinguishes unknown source changes from confirmed unchanged sources', () => {
  const node = pkg('a', { revision: { ...pkg('a').revision!, tag: null, state: 'untagged' } });
  const rendered = formatReleasePlan(createReleasePlan(report(node), 'a'));
  assert.match(rendered, /ソース変更: 未判定/);
  assert.match(rendered, /理由: 計画上の変更なし/);
  assert.match(rendered, /warning \[publication-baseline\]/);
  assert.match(rendered, /警告: 1件/);
  assert.match(rendered, /変更なしと確認されたものではありません/);
});

test('collection errors, absent metadata, invalid versions and mismatched package names block publication', () => {
  for (const changes of [
    { errors: ['npm unavailable'] }, { manifest: null }, { npm: undefined }, { dependencies: undefined },
    { revision: null }, { manifest: { ...pkg('a').manifest!, version: 'invalid' } },
    { manifest: { ...pkg('a').manifest!, name: '@family/other' } },
    { npm: { name: '@family/a', published: true, latest: null } },
    { npm: { name: '@family/a', published: true, latest: '1.2.3' } },
    { npm: { name: null, published: true, latest: '1.2.3', versions: ['1.2.3'] } },
    { npm: { name: '@family/a', published: true, latest: '1.2.3', versions: [] } },
  ]) {
    const plan = createReleasePlan(report(ahead('a', changes)), 'a');
    assert.equal(plan.ready, false, JSON.stringify(changes));
    assert.deepEqual(plan.publishTargets, [], JSON.stringify(changes));
  }
});

test('archived repositories and version overflow do not become publish targets', () => {
  const archived = ahead('a', { github: {
    name: 'a', description: null, url: 'https://github.com/family/a', homepageUrl: null,
    isArchived: true, isPrivate: false, isFork: false, pushedAt: null,
    stars: 0, license: null, openIssues: 0, openPullRequests: 0, defaultBranch: 'main',
  } });
  const overflow = ahead('a', {
    manifest: { ...pkg('a').manifest!, version: '1.9007199254740991.0' },
    npm: { name: '@family/a', published: true, latest: '1.9007199254740991.0', versions: ['1.9007199254740991.0'] },
  });
  overflow.revision!.tag!.name = 'v1.9007199254740991.0';
  for (const [node, code] of [[archived, 'archived'], [overflow, 'version-overflow']] as const) {
    const plan = createReleasePlan(report(node), 'a');
    assert.equal(plan.ready, false);
    assert.deepEqual(plan.publishTargets, []);
    assert(plan.steps[0].issues.some(issue => issue.code === code));
  }
});

test('an unknown or zero ahead count does not invent an unpublished change', () => {
  for (const aheadBy of [null, 0]) {
    const node = ahead('a');
    node.revision!.aheadBy = aheadBy;
    const plan = createReleasePlan(report(node), 'a');
    assert.equal(plan.ready, true);
    assert.equal(plan.steps[0].nextVersion, null);
    assert.equal(plan.steps[0].sourceChanges, 'unknown');
    assert(plan.steps[0].issues.some(i => i.code === 'revision-review' && i.severity === 'warning'));
  }
});

test('unknown targets, duplicate identities, missing upstreams and cycles stop planning', () => {
  assert.throws(() => createReleasePlan(report(pkg('a')), 'missing'), /不明/);
  assert.throws(() => createReleasePlan(report(pkg('a'), pkg('a')), 'a'), /重複/);
  assert.throws(() => createReleasePlan(report(pkg('a'), pkg('b', {
    manifest: { ...pkg('a').manifest! },
  })), 'a'), /重複/);
  assert.throws(() => createReleasePlan(report(pkg('a', { dependencies: [dep('missing')] })), 'a'), /上流パッケージがありません/);
  assert.throws(() => createReleasePlan(report(pkg('a', { dependencies: [dep('b')] }),
    pkg('b', { dependencies: [dep('a')] })), 'a'), /循環依存: a → b → a/);
  assert.throws(() => createReleasePlan(report(pkg('a', { dependencies: [dep('a')] })), 'a'), /循環依存: a → a/);
});

test('malformed snapshot fields produce input errors', () => {
  for (const input of [null, {}, { ...report(pkg('a')), generatedAt: 'not-a-date' },
    report({ ...pkg('a'), dependencies: {} } as unknown as DashboardPackage),
    report({ ...pkg('a'), npm: { ...pkg('a').npm, published: 'true' } } as unknown as DashboardPackage),
    report({ ...pkg('a'), errors: [null] } as unknown as DashboardPackage)]) {
    assert.throws(() => createReleasePlan(input, 'a'), /解析JSON/);
  }
});

test('human output includes order, version decisions, dependency changes, pins and targets', () => {
  const rendered = formatReleasePlan(createReleasePlan(report(pkg('a', { dependencies: [dep('b')] }), ahead('b')), 'a'));
  for (const pattern of [/計画のみ/, /処理順: b → a/, /head-a/, /1.2.3 → 1.3.0/, /dependencies.@family\/b/,
    /公開対象: 2件/, /@family\/a@1.3.0/]) assert.match(rendered, pattern);
});

test('CLI writes only stdout, works offline, validates flags, and reports blockers with exit code 2', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bump-plan-'));
  const cli = fileURLToPath(new URL('../scripts/bump.ts', import.meta.url));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const path = join(dir, 'dashboard.json');
  const offline = 'data:text/javascript,' + encodeURIComponent("globalThis.fetch = () => { throw new Error('Network must not be used'); };");
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', '--import', offline, cli, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '' }, timeout: 10000,
  });
  try {
    const source = JSON.stringify(report(pkg('a', { dependencies: [dep('b')] }), ahead('b')));
    await writeFile(path, source);
    const result = run('@family/a', '--data', path, '--json');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout).order, ['b', 'a']);
    assert.equal(await readFile(path, 'utf8'), source);
    assert.deepEqual(await readdir(dir), ['dashboard.json']);
    assert.match(run('a', '--data', path).stdout, /公開対象: 2件/);
    assert.equal(run('--help').status, 0);
    assert.equal(run('a', '--apply').status, 1);
    assert.equal(run('a', 'b').status, 1);
    assert.equal(run().status, 1);
    assert.equal(run('a', '--data', join(dir, 'missing.json')).status, 1);
    await writeFile(path, '{');
    assert.equal(run('a', '--data', path).status, 1);
    await writeFile(path, JSON.stringify(report(pkg('a', { dependencies: [dep('b')] }), pkg('b', { errors: ['collection failed'] }))));
    const blocked = run('a', '--data', path, '--json');
    assert.equal(blocked.status, 2);
    assert.equal(JSON.parse(blocked.stdout).ready, false);
    await writeFile(path, JSON.stringify(report(pkg('a', { dependencies: [dep('b', '1.0.0')] }),
      pkg('b', { revision: { ...pkg('b').revision!, tag: null, state: 'untagged' } }))));
    const warned = run('a', '--data', path, '--json');
    assert.equal(warned.status, 0);
    assert.equal(JSON.parse(warned.stdout).ready, true);
    assert.equal(JSON.parse(warned.stdout).steps[0].sourceChanges, 'unknown');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
