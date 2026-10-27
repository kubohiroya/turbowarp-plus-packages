import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executeReleasePlan, executionDigest, PHASES } from '../scripts/lib/release-execution.ts';
import type { ExecutionConfig, ExecutionEntry, ReleaseDriver } from '../scripts/lib/release-execution.ts';
import type { ReleasePlan, PackagePlan } from '../scripts/lib/release-plan.ts';
import { parsePackResult } from '../scripts/lib/release-driver.ts';
import { releaseVersionsMatch } from '../scripts/lib/release-version.ts';

export function fixture(): { plan: ReleasePlan; config: ExecutionConfig } {
  const steps: PackagePlan[] = ['upstream', 'downstream'].map((repo, index) => ({
    repo, repository: `family/${repo}`, name: `@family/${repo}`, headSha: String(index + 1).repeat(40),
    currentVersion: '1.0.0', publishedVersion: '1.0.0', nextVersion: '1.1.0', versionChange: 'minor',
    sourceChanges: 'ahead', action: 'publish', reasons: ['commits-ahead'], issues: [],
    dependencyUpdates: index ? [{ field: 'dependencies', name: '@family/upstream', upstreamRepo: 'upstream', from: '^1.0.0', to: '^1.1.0', targetVersion: '1.1.0', source: 'planned' }] : [],
  }));
  const plan: ReleasePlan = {
    schemaVersion: 1, mode: 'plan', target: 'downstream', ready: true, applyReady: true,
    snapshot: { generatedAt: '2026-10-26T00:00:00Z', sha256: 'a'.repeat(64) },
    order: steps.map(step => step.repo), steps,
    publishTargets: steps.map(step => ({ repository: step.repository, name: step.name!, version: '1.1.0', tag: 'v1.1.0', headSha: step.headSha! })),
  };
  const config: ExecutionConfig = { schemaVersion: 1, repositories: Object.fromEntries(steps.map(step => [step.repository, {
    install: [['npm', 'ci']], verify: [['npm', 'run', 'check']], publish: { mode: 'cli', provenance: false },
  }])) };
  return { plan, config };
}

function fakeDriver(events: string[], fail?: string): ReleaseDriver {
  const record = (phase: string) => async (step: PackagePlan, _profile: unknown, entry: ExecutionEntry) => {
    events.push(`${step.repo}:${phase}`);
    if (`${step.repo}:${phase}` === fail) throw new Error('injected failure');
    if (phase === 'prepared') entry.shasum = 'a'.repeat(40);
  };
  return Object.fromEntries(['preflight', ...PHASES.slice(1)].map(phase => [phase, record(phase)])) as unknown as ReleaseDriver;
}

test('upstream verification gates every downstream mutation; a failed publication resumes without preparing twice', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-state-'));
  try {
    const { plan, config } = fixture();
    const digest = executionDigest(plan, config);
    const events: string[] = [];
    await assert.rejects(executeReleasePlan(plan, config, root, () => fakeDriver(events, 'upstream:published'), digest), /injected/u);
    assert(!events.includes('downstream:prepared'));
    const saved = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
    assert.equal(saved.entries.upstream.phase, 'released');
    assert.equal(saved.entries.upstream.error, 'injected failure');
    assert(!(await readdir(root)).includes('.execution-lock'));
    events.length = 0;
    const result = await executeReleasePlan(plan, config, root, () => fakeDriver(events), digest);
    assert(!events.includes('upstream:prepared'));
    assert(events.indexOf('upstream:complete') < events.indexOf('downstream:prepared'));
    assert.equal(result.entries.downstream.phase, 'complete');
    events.length = 0;
    await executeReleasePlan(plan, config, root, () => fakeDriver(events), digest);
    assert.deepEqual(events, ['upstream:preflight', 'downstream:preflight', 'upstream:complete', 'downstream:complete']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('all target preflights finish before the first prepare', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-preflight-'));
  try {
    const { plan, config } = fixture(); const events: string[] = [];
    await assert.rejects(executeReleasePlan(plan, config, root, () => fakeDriver(events, 'downstream:preflight'), executionDigest(plan, config)));
    assert.deepEqual(events, ['upstream:preflight', 'downstream:preflight']);
    const saved = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
    assert.equal(saved.entries.downstream.error, 'injected failure');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unconfirmed inputs, incomplete profiles and reversed dependency order never execute', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-input-'));
  try {
    const { plan, config } = fixture(); let created = false;
    await assert.rejects(executeReleasePlan(plan, config, root, () => { created = true; return fakeDriver([]); }, 'incorrect'), /digest/u);
    assert.equal(created, false);
    assert.deepEqual(await readdir(root), []);
    const changed = structuredClone(config); changed.repositories['family/upstream'].verify = [];
    assert.throws(() => executionDigest(plan, changed), /実行設定/u);
    const reversed = structuredClone(plan); reversed.steps.reverse(); reversed.order.reverse();
    assert.throws(() => executionDigest(reversed, config), /DFS/u);
    const tampered = structuredClone(plan); tampered.steps[0].repository = 'family/../oops';
    assert.throws(() => executionDigest(tampered, config), /不正/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('review decisions are scoped to repositories and bound into the confirmed digest', () => {
  const { plan, config } = fixture();
  plan.steps[0].issues.push({ severity: 'warning', code: 'peer', message: 'review', requiresReview: true });
  assert.throws(() => executionDigest(plan, config), /レビュー/u);
  config.reviewedRepositories = ['family/upstream'];
  const first = executionDigest(plan, config);
  config.repositories['family/upstream'].verify.push(['npm', 'run', 'test:browser']);
  assert.notEqual(executionDigest(plan, config), first);
});

test('a changed config cannot reuse an old journal and concurrent runs do not steal locks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-resume-'));
  try {
    const { plan, config } = fixture();
    await executeReleasePlan(plan, config, root, () => fakeDriver([]), executionDigest(plan, config));
    config.repositories['family/upstream'].verify.push(['npm', 'test']);
    await assert.rejects(executeReleasePlan(plan, config, root, () => fakeDriver([]), executionDigest(plan, config)), /再開記録/u);
    await import('node:fs/promises').then(fs => fs.mkdir(join(root, '.execution-lock')));
    await assert.rejects(executeReleasePlan(plan, config, root, () => fakeDriver([]), executionDigest(plan, config)), /進行中/u);
    assert((await readdir(root)).includes('.execution-lock'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('npm11 and npm12 pack JSON identify exactly one planned artifact', () => {
  const pack = { name: '@family/a', version: '1.0.0', filename: 'family-a-1.0.0.tgz', shasum: 'a'.repeat(40) };
  assert.equal(parsePackResult(JSON.stringify([pack]), pack.name, pack.version).filename, pack.filename);
  assert.equal(parsePackResult(JSON.stringify({ [pack.name]: pack }), pack.name, pack.version).filename, pack.filename);
  assert.throws(() => parsePackResult(JSON.stringify([pack, pack]), pack.name, pack.version));
  assert.throws(() => parsePackResult(JSON.stringify([{ ...pack, filename: '../other.tgz' }]), pack.name, pack.version));
  assert.throws(() => parsePackResult(JSON.stringify([pack]), pack.name, '2.0.0'));
});

test('release tag comparison preserves RC identifiers and rejects arbitrary tag fragments', () => {
  assert.equal(releaseVersionsMatch('4.0.0-rc.58', 'v4.0.0-rc.58'), true);
  assert.equal(releaseVersionsMatch('4.0.0-rc.58', 'v4.0.0'), false);
  assert.equal(releaseVersionsMatch('0.17.0', 'v0.8.0'), false);
  assert.equal(releaseVersionsMatch('1.0.0', 'build-1.0.0-preview'), null);
});

test('release CLI dry-run prints approved actions and performs no writes or external commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-cli-'));
  try {
    const { plan, config } = fixture();
    const planFile = join(root, 'plan.json'), configFile = join(root, 'config.json'), workspace = join(root, 'execution');
    for (const profile of Object.values(config.repositories)) profile.publish = { mode: 'tag-workflow', workflow: 'release.yml' };
    config.trustedPublisherOnly = true;
    await writeFile(planFile, JSON.stringify(plan)); await writeFile(configFile, JSON.stringify(config));
    const args = ['--import', 'tsx', fileURLToPath(new URL('../scripts/release.ts', import.meta.url)), '--plan', planFile, '--config', configFile, '--workspace', workspace];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.mode, 'dry-run'); assert.equal(preview.digest, executionDigest(plan, config));
    assert.deepEqual(preview.steps.map((step: { repository: string }) => step.repository), ['family/upstream', 'family/downstream']);
    assert.deepEqual((await readdir(root)).sort(), ['config.json', 'plan.json']);
    const rejected = spawnSync(process.execPath, [...args, '--execute', '--confirm', 'incorrect'], { encoding: 'utf8' });
    assert.equal(rejected.status, 1); assert.match(rejected.stderr, /digest/u);
    assert.deepEqual((await readdir(root)).sort(), ['config.json', 'plan.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
