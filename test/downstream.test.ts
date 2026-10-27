import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs, { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { applyReleasePlan } from '../scripts/lib/apply-release-plan.ts';
import { createDownstreamReleasePlan, createReleasePlan, formatReleasePlan } from '../scripts/lib/release-plan.ts';
import { DEPENDENCY_KINDS } from '../scripts/lib/dependencies.ts';
import type { DashboardPackage, DashboardReport, Dependency } from '../scripts/lib/types.ts';

function pkg(repo: string, dependencies: Dependency[] = []): DashboardPackage {
  return {
    repo, label: repo, category: 'test', note: null, errors: [], dependencies,
    manifest: { name: `@family/${repo}`, version: '1.2.3', private: false, license: null },
    npm: { name: `@family/${repo}`, published: true, latest: '1.2.3', versions: ['1.2.3'] },
    revision: {
      state: 'released', head: { oid: `head-${repo}`, committedDate: '2026-10-25T00:00:00Z' },
      tag: { name: 'v1.2.3', oid: `head-${repo}`, committedDate: null }, release: null, aheadBy: 0,
    },
  };
}

const dep = (repo: string, range = '1.2.3', kind: Dependency['kind'] = 'prod'): Dependency =>
  ({ name: `@family/${repo}`, range, kind, family: true, local: false, stale: false });
const report = (...packages: DashboardPackage[]): DashboardReport =>
  ({ generatedAt: '2026-10-25T00:00:00Z', owner: 'family', scope: '@family', site: {}, categories: [], packages });
function prepared(repo: string): DashboardPackage {
  const result = pkg(repo);
  result.manifest!.version = '1.3.0';
  return result;
}

test('downstream reconciliation bumps an unregistered root and its consumers once', () => {
  const root = pkg('tool');
  root.revision!.tag!.name = 'v1.0.0';
  const plan = createDownstreamReleasePlan(report(root, pkg('app', [dep('tool')])), 'tool', { reconcile: true });
  assert.deepEqual(plan.order, ['tool', 'app']);
  assert(plan.steps[0].reasons.includes('github-registration'));
  assert.deepEqual(plan.steps.map(step => step.nextVersion), ['1.3.0', '1.3.0']);
});

test('downstream traversal orders a diamond once, propagates versions and keeps upstream mode unchanged', () => {
  const input = report(pkg('top', [dep('right'), dep('left')]), pkg('right', [dep('tool')]),
    pkg('left', [dep('tool')]), prepared('tool'), prepared('unrelated'));
  const before = JSON.stringify(input);
  const plan = createDownstreamReleasePlan(input, '@family/tool');
  assert.deepEqual(plan.order, ['tool', 'left', 'right', 'top']);
  assert.equal(plan.direction, 'downstream');
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.steps.map(s => s.nextVersion), ['1.3.0', '1.3.0', '1.3.0', '1.3.0']);
  assert.deepEqual(plan.steps.map(s => s.versionChange), ['prepared', 'minor', 'minor', 'minor']);
  assert.equal(plan.steps[3].dependencyUpdates.length, 2);
  assert.deepEqual(plan.publishTargets.map(s => s.name), ['@family/tool', '@family/left', '@family/right', '@family/top']);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(createReleasePlan(input, 'tool').order, ['tool']);
  assert.deepEqual(createDownstreamReleasePlan({ ...input, packages: [...input.packages].reverse() }, 'tool').order, plan.order);
  assert.match(formatReleasePlan(plan), /依存元へ伝播/);
});

test('an already published root updates all stale dev and optional consumers without bumping itself', () => {
  const plan = createDownstreamReleasePlan(report(pkg('tool'),
    pkg('a', [dep('tool', '^1.0.0', 'dev')]), pkg('b', [dep('tool', '~1.0.0', 'optional')]),
    pkg('c', [dep('a')]), pkg('external', [{ ...dep('tool'), family: false }])), 'tool');
  assert.deepEqual(plan.order, ['tool', 'a', 'b', 'c']);
  assert.equal(plan.steps[0].action, 'none');
  assert.deepEqual(plan.steps.slice(1).map(s => s.nextVersion), ['1.3.0', '1.3.0', '1.3.0']);
  assert.equal(plan.steps[1].dependencyUpdates[0].to, '^1.2.3');
  assert.equal(plan.steps[1].dependencyUpdates[0].field, 'devDependencies');
  assert.equal(plan.steps[2].dependencyUpdates[0].to, '~1.2.3');
});

test('unrelated upstream changes and stale dependencies stay outside the bump scope', () => {
  const input = report(pkg('tool', [dep('other', '1.0.0')]),
    pkg('a', [dep('tool', '1.0.0'), dep('other', '1.0.0')]), prepared('other'),
    pkg('sibling', [dep('other')]));
  const plan = createDownstreamReleasePlan(input, 'tool');
  assert.deepEqual(plan.order, ['tool', 'a']);
  assert.equal(plan.steps[0].action, 'none');
  assert.deepEqual(plan.steps[1].dependencyUpdates.map(u => u.name), ['@family/tool']);
  assert.equal(plan.steps[1].dependencyUpdates[0].source, 'published');
});

test('compatible peers and broad ranges stay unchanged, and an unchanged graph needs no bumps', () => {
  const plan = createDownstreamReleasePlan(report(pkg('tool'), pkg('a', [dep('tool', '^1.0.0', 'peer')]),
    pkg('b', [dep('tool', '>=1 <2')]), pkg('c', [dep('tool')])), 'tool');
  assert.deepEqual(plan.order, ['tool', 'a', 'b', 'c']);
  assert(plan.steps.every(s => s.action === 'none'));
  assert.deepEqual(plan.publishTargets, []);
});

test('peer proposals propagate with review required while collection failures still block', () => {
  const plan = createDownstreamReleasePlan(report(prepared('tool'),
    pkg('a', [dep('tool', '1.2.3', 'peer')]), pkg('b', [dep('a')])), 'tool');
  assert.equal(plan.ready, true);
  assert.equal(plan.applyReady, false);
  assert.equal(plan.steps[1].dependencyUpdates[0].to, '1.3.0');
  assert(plan.steps[1].issues.some(i => i.code === 'peer-compatibility' && i.requiresReview));
  assert.equal(plan.steps[2].dependencyUpdates[0].to, '1.3.0');
  const broken = pkg('other');
  broken.errors.push('manifest fetch failed');
  const failed = createDownstreamReleasePlan(report(pkg('tool'), broken,
    pkg('a', [dep('tool', '1.0.0'), dep('other')])), 'tool');
  assert.equal(failed.ready, false);
  assert(failed.steps[1].issues.some(i => i.code === 'upstream-blocked'));
});

test('private consumers are update-only and do not enter the publication list', () => {
  const consumer = pkg('a', [dep('tool', '1.0.0')]);
  consumer.manifest!.private = true;
  const plan = createDownstreamReleasePlan(report(pkg('tool'), consumer), 'tool');
  assert.equal(plan.steps[1].action, 'update-only');
  assert.deepEqual(plan.publishTargets, []);
});

test('downstream discovery rejects ambiguous inputs, missing dependency lists, missing selected upstreams and cycles', () => {
  assert.throws(() => createDownstreamReleasePlan(report(pkg('a')), 'unknown'), /不明/);
  assert.throws(() => createDownstreamReleasePlan(report(pkg('a'), pkg('a')), 'a'), /重複/);
  const unknown = pkg('unrelated');
  delete unknown.dependencies;
  assert.throws(() => createDownstreamReleasePlan(report(pkg('a'), unknown), 'a'), /依存元を確定できません/);
  assert.throws(() => createDownstreamReleasePlan(report(pkg('tool'), pkg('a', [dep('tool'), dep('missing')])), 'tool'), /上流パッケージがありません/);
  assert.throws(() => createDownstreamReleasePlan(report(pkg('tool'), pkg('a', [dep('tool'), dep('b')]), pkg('b', [dep('a')])), 'tool'), /循環依存/);
  // Unknown edges in unrelated components do not affect the selected closure.
  assert.deepEqual(createDownstreamReleasePlan(report(pkg('tool'), pkg('other', [dep('missing')])), 'tool').order, ['tool']);
});

const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
async function checkout(parent: string, item: DashboardPackage): Promise<string> {
  const repo = join(parent, item.repo);
  await mkdir(repo);
  const manifest = { ...item.manifest };
  for (const [field, kind] of Object.entries(DEPENDENCY_KINDS)) {
    const entries = item.dependencies!.filter(dep => dep.kind === kind).map(dep => [dep.name, dep.range]);
    if (entries.length) Object.assign(manifest, { [field]: Object.fromEntries(entries) });
  }
  await writeFile(join(repo, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(repo, 'package-lock.json'), '{"unchanged":true}\n');
  git(repo, '-c', 'init.templateDir=', 'init', '-q', '-b', 'main');
  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
  item.revision!.head!.oid = git(repo, 'rev-parse', 'HEAD');
  item.revision!.tag!.oid = item.revision!.head!.oid;
  return repo;
}

test('local apply updates manifests in order, preserves locks, and a refreshed snapshot has no further bumps', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'downstream-apply-'));
  try {
    const tool = pkg('tool');
    const a = pkg('a', [dep('tool', '^1.0.0', 'dev')]);
    const b = pkg('b', [dep('a')]);
    for (const p of [tool, a, b]) await checkout(dir, p);
    const original = await readFile(join(dir, 'tool/package.json'), 'utf8');
    const files = await applyReleasePlan(createDownstreamReleasePlan(report(tool, a, b), 'tool'), dir);
    assert.deepEqual(files.map(p => p.split('/').slice(-2).join('/')), ['a/package.json', 'b/package.json']);
    assert.equal(await readFile(join(dir, 'tool/package.json'), 'utf8'), original);
    const first = JSON.parse(await readFile(join(dir, 'a/package.json'), 'utf8'));
    const second = JSON.parse(await readFile(join(dir, 'b/package.json'), 'utf8'));
    assert.equal(first.version, '1.3.0');
    assert.equal(first.devDependencies['@family/tool'], '^1.2.3');
    assert.equal(second.dependencies['@family/a'], '1.3.0');
    assert.equal(second.version, '1.3.0');
    assert.equal(await readFile(join(dir, 'a/package-lock.json'), 'utf8'), '{"unchanged":true}\n');
    assert.deepEqual((await readdir(join(dir, 'a'))).sort(), ['.git', 'package-lock.json', 'package.json']);
    a.manifest!.version = b.manifest!.version = '1.3.0';
    a.npm!.latest = b.npm!.latest = '1.3.0';
    a.npm!.versions!.push('1.3.0');
    b.npm!.versions!.push('1.3.0');
    a.revision!.tag!.name = b.revision!.tag!.name = 'v1.3.0';
    a.dependencies![0].range = '^1.2.3';
    b.dependencies![0].range = '1.3.0';
    assert.deepEqual(createDownstreamReleasePlan(report(tool, a, b), 'tool').publishTargets, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('preflight failures in a later checkout leave earlier manifests untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'downstream-preflight-'));
  try {
    const tool = pkg('tool');
    const a = pkg('a', [dep('tool', '1.0.0')]);
    const b = pkg('b', [dep('a')]);
    for (const p of [tool, a, b]) await checkout(dir, p);
    const plan = createDownstreamReleasePlan(report(tool, a, b), 'tool');
    const original = await readFile(join(dir, 'a/package.json'), 'utf8');
    await writeFile(join(dir, 'b/untracked'), 'keep');
    await assert.rejects(applyReleasePlan(plan, dir), /未コミット変更または未追跡/);
    assert.equal(await readFile(join(dir, 'a/package.json'), 'utf8'), original);
    await rm(join(dir, 'b/untracked'));
    plan.steps[2].headSha = 'stale';
    await assert.rejects(applyReleasePlan(plan, dir), /SHAと異なります/);
    assert.equal(await readFile(join(dir, 'a/package.json'), 'utf8'), original);
    plan.steps[2].headSha = b.revision!.head!.oid;
    plan.steps[2].dependencyUpdates[0].from = 'stale';
    await assert.rejects(applyReleasePlan(plan, dir), /解析結果と異なる/);
    assert.equal(await readFile(join(dir, 'a/package.json'), 'utf8'), original);
    plan.steps[2].dependencyUpdates[0].from = '1.2.3';
    plan.steps[2].currentVersion = '9.9.9';
    await assert.rejects(applyReleasePlan(plan, dir), /name\/version/);
    plan.steps[2].currentVersion = '1.2.3';
    await rm(join(dir, 'b'), { recursive: true });
    await assert.rejects(applyReleasePlan(plan, dir), /ENOENT/);
    assert.equal(await readFile(join(dir, 'a/package.json'), 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('review-required peer, Git and RC proposals cannot write even when planning is complete', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'downstream-review-'));
  try {
    for (const mode of ['peer', 'git', 'rc']) {
      const tool = pkg('tool');
      const a = pkg('a', [dep('tool', mode === 'git' ? 'git+https://github.com/family/tool.git#abc' : '0.1.0',
        mode === 'peer' ? 'peer' : 'prod')]);
      if (mode === 'rc') a.manifest!.version = '2.0.0-rc.1';
      for (const p of [tool, a]) await checkout(dir, p);
      const plan = createDownstreamReleasePlan(report(tool, a), 'tool');
      const path = join(dir, 'a/package.json');
      const before = await readFile(path, 'utf8');
      assert.equal(plan.ready, true);
      assert.equal(plan.applyReady, false);
      await assert.rejects(applyReleasePlan(plan, dir), /レビューが必要/);
      // The issue-level guard also rejects a mistakenly enabled aggregate flag.
      plan.applyReady = true;
      await assert.rejects(applyReleasePlan(plan, dir), /レビューが必要/);
      assert.equal(await readFile(path, 'utf8'), before);
      for (const p of [tool, a]) await rm(join(dir, p.repo), { recursive: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('apply refuses blocked or upstream plans and unsafe checkout names before writing', async () => {
  const broken = pkg('tool');
  broken.errors.push('collection failed');
  const blocked = createDownstreamReleasePlan(report(broken, pkg('a', [dep('tool')])), 'tool');
  await assert.rejects(applyReleasePlan(blocked, '/missing'), /未解決事項/);
  await assert.rejects(applyReleasePlan(createReleasePlan(report(pkg('tool')), 'tool'), '/missing'), /依存元への計画だけ/);
  const plan = createDownstreamReleasePlan(report(pkg('../escape')), '../escape');
  await assert.rejects(applyReleasePlan(plan, tmpdir()), /不正なrepo名/);
});

for (const concurrent of [false, true]) {
  test(concurrent ? 'rollback reports concurrent edits without overwriting them' :
    'a failed later write restores earlier bytes and removes temporary files', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'downstream-rollback-'));
    try {
      const tool = pkg('tool');
      const a = pkg('a', [dep('tool', '1.0.0')]);
      const b = pkg('b', [dep('a')]);
      for (const p of [tool, a, b]) await checkout(dir, p);
      const plan = createDownstreamReleasePlan(report(tool, a, b), 'tool');
      const first = join(dir, 'a/package.json');
      const before = await readFile(first, 'utf8');
      const lastBefore = await readFile(join(dir, 'b/package.json'), 'utf8');
      const rename = fs.rename;
      let calls = 0;
      t.mock.method(fs, 'rename', async (...args: Parameters<typeof rename>) => {
        if (++calls === 2) {
          if (concurrent) await writeFile(first, 'concurrent edit');
          throw new Error('simulated write failure');
        }
        return rename(...args);
      });
      syncBuiltinESMExports();
      await assert.rejects(applyReleasePlan(plan, dir), concurrent ? /自動復元できない.*a\/package.json/ : /simulated write failure/);
      assert.equal(await readFile(first, 'utf8'), concurrent ? 'concurrent edit' : before);
      assert.equal(await readFile(join(dir, 'b/package.json'), 'utf8'), lastBefore);
      for (const repo of ['a', 'b']) {
        assert.deepEqual((await readdir(join(dir, repo))).sort(), ['.git', 'package-lock.json', 'package.json']);
      }
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test('downstream CLI is offline, validates flags, reports blockers, and applies only with explicit options', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'downstream-cli-'));
  const cli = fileURLToPath(new URL('../scripts/bump-downstream.ts', import.meta.url));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const path = join(dir, 'dashboard.json');
  const offline = 'data:text/javascript,' + encodeURIComponent("globalThis.fetch = () => { throw new Error('Network must not be used'); };");
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', '--import', offline, cli, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '' }, timeout: 10000,
  });
  try {
    const tool = pkg('tool');
    const a = pkg('a', [dep('tool', '1.0.0', 'dev')]);
    for (const p of [tool, a]) await checkout(dir, p);
    const input = JSON.stringify(report(tool, a));
    await writeFile(path, input);
    const original = await readFile(join(dir, 'a/package.json'), 'utf8');
    const preview = run('@family/tool', '--data', path, '--json');
    assert.equal(preview.status, 0, preview.stderr);
    assert.deepEqual(JSON.parse(preview.stdout).order, ['tool', 'a']);
    assert.equal(await readFile(join(dir, 'a/package.json'), 'utf8'), original);
    assert.equal(await readFile(path, 'utf8'), input);
    assert.match(run('tool', '--data', path).stdout, /依存元へ伝播/);
    assert.equal(run('--help').status, 0);
    for (const args of [[], ['tool', 'a'], ['tool', '--apply'], ['tool', '--repos-dir', dir], ['tool', '--unknown'], ['tool', '--data', '/missing']]) {
      assert.equal(run(...args).status, 1, args.join(' '));
    }
    const applied = run('tool', '--data', path, '--json', '--apply', '--repos-dir', dir);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(JSON.parse(applied.stdout).files.length, 1);
    assert.equal(JSON.parse(await readFile(join(dir, 'a/package.json'), 'utf8')).version, '1.3.0');
    await writeFile(path, JSON.stringify(report(pkg('tool'), pkg('a', [dep('tool', '0.1.0', 'peer')]))));
    const beforeBlocked = await readFile(join(dir, 'a/package.json'), 'utf8');
    const blocked = run('tool', '--data', path, '--apply', '--repos-dir', dir, '--json');
    assert.equal(blocked.status, 2);
    assert.equal(JSON.parse(blocked.stdout).ready, true);
    assert.equal(JSON.parse(blocked.stdout).applyReady, false);
    assert.equal(await readFile(join(dir, 'a/package.json'), 'utf8'), beforeBlocked);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
