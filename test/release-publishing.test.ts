import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { CommandFailure, GithubNpmReleaseDriver } from '../scripts/lib/release-driver.ts';
import type { Runner } from '../scripts/lib/release-driver.ts';
import type { ExecutionConfig, ExecutionEntry, ExecutionState, ReleaseProfile } from '../scripts/lib/release-execution.ts';
import type { PackagePlan } from '../scripts/lib/release-plan.ts';

const sha = 'a'.repeat(40);
const step: PackagePlan = { repo: 'tool', repository: 'family/tool', name: '@family/tool', headSha: sha,
  currentVersion: '1.0.0', publishedVersion: '1.0.0', nextVersion: '1.1.0', versionChange: 'minor', action: 'publish',
  sourceChanges: 'ahead', reasons: ['commits-ahead'], dependencyUpdates: [], issues: [] };
const profile: ReleaseProfile = { npm: ['fixture-npm'], install: [['fixture-install']], verify: [['fixture-verify']], publish: { mode: 'cli', provenance: false } };
// npm records the commit a version was published from as gitHead.
const registry = JSON.stringify({ name: step.name, version: '1.1.0', gitHead: sha, dist: {} });
const elsewhere = JSON.stringify({ name: step.name, version: '1.1.0', gitHead: 'e'.repeat(40), dist: {} });
const missing = (command: string[]) => new CommandFailure(command, '{"error":{"code":"E404"}}', 'E404', 1);
const record = (): ExecutionEntry => ({ phase: 'released', commit: sha, mergeCommit: sha, base: 'main' });
function driver(run: Runner, entry: ExecutionEntry, save = async () => {}, root = '/unused') {
  const config: ExecutionConfig = { schemaVersion: 1, workflowTimeoutSeconds: 20, repositories: {} };
  const state: ExecutionState = { schemaVersion: 1, digest: 'c'.repeat(64), entries: { tool: entry } };
  return new GithubNpmReleaseDriver(root, config, state, save, run, async () => {});
}

test('accepted CLI publication waits through registry delay without publishing again', async () => {
  const entry = record(); let reads = 0, submits = 0, checkpoints = 0;
  const execute = driver(async command => {
    if (command[1] === 'view') { if (++reads <= 2) throw missing(command); return registry; }
    assert.equal(command[1], 'publish'); submits++; return '';
  }, entry, async () => { checkpoints++; });
  await execute.published(step, profile, entry);
  assert.equal(submits, 1); assert(entry.publishAccepted); assert(checkpoints >= 2);
  await execute.published(step, profile, entry);
  assert.equal(submits, 1);
});

test('an interrupted CLI publish is never blindly retried', async () => {
  const entry = record(); let submits = 0;
  const execute = driver(async command => {
    if (command[1] === 'view') throw missing(command);
    submits++; throw new CommandFailure(command, '', 'connection lost', 1);
  }, entry);
  await assert.rejects(execute.published(step, profile, entry), /connection lost/u);
  assert(entry.publishStartedAt && !entry.publishAccepted);
  await assert.rejects(execute.published(step, profile, entry), /timeout/u);
  assert.equal(submits, 1);
});

test('tag workflow selection ignores runs for main and accepts the version npm says came from the release commit', async () => {
  const entry = record(); let reads = 0;
  const configured: ReleaseProfile = { ...profile, publish: { mode: 'tag-workflow', workflow: 'release.yml' } };
  const execute = driver(async command => {
    assert.notEqual(command[1], 'pack', 'no tarball is made or fetched');
    if (command[0] === 'fixture-npm') { if (++reads === 1) throw missing(command); return registry; }
    assert.equal(command[1], 'api');
    return JSON.stringify({ workflow_runs: [
      { id: 40, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'failure' },
      { id: 42, head_sha: sha, head_branch: 'v1.1.0', event: 'push', status: 'completed', conclusion: 'success' },
    ] });
  }, entry);
  await execute.published(step, configured, entry);
  assert.equal(entry.workflowRun, 42);
});

test('a version npm says came from another commit stops the chain', async () => {
  const entry = record(); entry.workflowRun = 42; let reads = 0;
  const configured: ReleaseProfile = { ...profile, publish: { mode: 'tag-workflow', workflow: 'release.yml' } };
  const execute = driver(async command => {
    if (command[0] === 'fixture-npm') { if (++reads === 1) throw missing(command); return elsewhere; }
    return JSON.stringify({ workflow_runs: [
      { id: 42, head_sha: sha, head_branch: 'v1.1.0', event: 'push', status: 'completed', conclusion: 'success' },
    ] });
  }, entry);
  await assert.rejects(execute.published(step, configured, entry), /このリリースのコミットから公開されていません/u);
});

test('a visible npm version cannot hide a failed publication workflow', async () => {
  const entry = record(); entry.workflowRun = 42;
  const configured: ReleaseProfile = { ...profile, publish: { mode: 'tag-workflow', workflow: 'release.yml' } };
  const execute = driver(async command => command[0] === 'fixture-npm' ? registry : JSON.stringify({ workflow_runs: [
    { id: 42, head_sha: sha, head_branch: 'v1.1.0', event: 'push', status: 'completed', conclusion: 'failure' },
  ] }), entry);
  await assert.rejects(execute.published(step, configured, entry), /公開workflow失敗/u);
});

test('resuming a dispatched workflow does not dispatch or publish twice', async () => {
  const entry = record(); entry.workflowRun = 42; entry.dispatchStartedAt = '2026-10-26T00:00:00Z'; entry.dispatchHeadSha = sha;
  const configured: ReleaseProfile = { ...profile, publish: { mode: 'dispatch-workflow', workflow: 'release.yml' } };
  const execute = driver(async command => {
    if (command[0] === 'fixture-npm') return registry;
    assert.equal(command[1], 'api', 'must not invoke gh workflow run twice');
    return JSON.stringify({ workflow_runs: [{ id: 42, head_sha: sha, head_branch: 'main', event: 'workflow_dispatch',
      created_at: '2026-10-26T00:00:01Z', status: 'completed', conclusion: 'success' }] });
  }, entry);
  await execute.published(step, configured, entry);
});

test('an existing tag pointing at another commit is never overwritten', async () => {
  const entry = record();
  const execute = driver(async command => {
    assert.equal(command[0], 'gh', 'must not run git tag or push');
    return JSON.stringify({ object: { type: 'commit', sha: 'd'.repeat(40) } });
  }, entry);
  await assert.rejects(execute.tagged(step, profile, entry), /既存タグ/u);
});

test('existing publication source with the wrong package version cannot be registered', async () => {
  const entry: ExecutionEntry = { phase: 'pending' };
  const unchanged: PackagePlan = { ...step, action: 'none', nextVersion: null, publishedVersion: '1.1.0' };
  const execute = driver(async command => {
    if (command[0] === 'fixture-npm') return registry;
    assert.equal(command[0], 'gh'); assert.equal(command[1], 'api');
    const path = command.at(-1)!;
    if (path === 'repos/family/tool') return JSON.stringify({ default_branch: 'main', archived: false, permissions: { push: true } });
    if (path.includes('contents/')) return JSON.stringify({ encoding: 'base64', content: Buffer.from(JSON.stringify({ name: step.name, version: '1.0.0' })).toString('base64') });
    return JSON.stringify({ object: { type: 'commit', sha } });
  }, entry);
  await assert.rejects(execute.preflight(unchanged, profile, entry), /GitHubソース/u);
});

test('an unchanged private package is checked by its source only, without npm or tags', async () => {
  const entry: ExecutionEntry = { phase: 'pending' };
  const unchanged: PackagePlan = { ...step, action: 'none', nextVersion: null, publishedVersion: null };
  const execute = driver(async command => {
    if (command[0] === 'fixture-npm') {
      assert.equal(command[1], 'view'); assert.equal(command[3], 'dist-tags', 'must not look up a release');
      throw missing(command);
    }
    assert.equal(command[0], 'gh'); assert.equal(command[1], 'api');
    const path = command.at(-1)!;
    assert(!path.includes('/tags/') && !path.includes('/releases/'), 'must not look up a tag or Release');
    if (path === 'repos/family/tool') return JSON.stringify({ default_branch: 'main', archived: false, permissions: { push: true } });
    return JSON.stringify({ object: { type: 'commit', sha } });
  }, entry);
  for (const phase of ['preflight', 'prepared', 'pushed', 'merged', 'tagged', 'released', 'published', 'complete'] as const) {
    await execute[phase](unchanged, profile, entry);
  }
  assert.equal(entry.mergeCommit, undefined);
});

test('completing an older release never downgrades a newer next tag', async () => {
  const entry = record();
  const unchanged: PackagePlan = { ...step, action: 'none', nextVersion: null, publishedVersion: '1.1.0' };
  const execute = driver(async command => {
    if (command[0] === 'fixture-npm') {
      assert.equal(command[1], 'view', 'must not change dist-tags');
      return command[3] === 'dist-tags' ? '{"latest":"1.1.0","next":"1.2.0"}' : registry;
    }
    const path = command.at(-1)!;
    if (path.includes('contents/')) return JSON.stringify({ encoding: 'base64', content: Buffer.from(JSON.stringify({ name: step.name, version: '1.1.0' })).toString('base64') });
    if (path.includes('/releases/')) return '{"tag_name":"v1.1.0","draft":false,"assets":[]}';
    return JSON.stringify({ object: { type: 'commit', sha } });
  }, entry);
  await assert.rejects(execute.complete(unchanged, profile, entry), /下げず/u);
});

for (const mode of ['dirty-verification', 'clean']) test(`a saved candidate is verified again without packing (${mode})`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-candidate-'));
  try {
    const cwd = join(root, 'checkouts', step.repo);
    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: step.name, version: '1.1.0' }));
    const entry: ExecutionEntry = { phase: 'pending', commit: sha };
    const state: ExecutionState = { schemaVersion: 1, digest: 'c'.repeat(64), entries: { tool: entry } };
    let verified = 0;
    const run: Runner = async command => {
      if (command[0] === 'fixture-verify') { verified++; return ''; }
      if (command[0] === 'git' && command[1] === 'rev-parse') return sha;
      if (command[0] === 'git' && command[1] === 'status') return mode === 'dirty-verification' ? ' M generated.js' : '';
      assert.fail(`resume must not pack, prepare, push or publish: ${command.join(' ')}`);
    };
    const execute = new GithubNpmReleaseDriver(root, { schemaVersion: 1, repositories: {} }, state, async () => {}, run);
    if (mode === 'clean') await execute.prepared(step, profile, entry);
    else await assert.rejects(execute.prepared(step, profile, entry), /未コミット/);
    assert.equal(verified, 1);
    assert.deepEqual(await readdir(join(root, 'artifacts', step.repo)).catch(() => []), [], 'no archive is written');
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const syncedAfter of [2, Infinity]) test(`trusted publishing waits for release.yml to move the dist-tags (synced after ${syncedAfter} reads)`, async () => {
  const entry = record();
  const unchanged: PackagePlan = { ...step, action: 'none', nextVersion: null, publishedVersion: '1.1.0' };
  let reads = 0;
  const config: ExecutionConfig = { schemaVersion: 1, workflowTimeoutSeconds: 20, trustedPublisherOnly: true, repositories: {} };
  const state: ExecutionState = { schemaVersion: 1, digest: 'c'.repeat(64), entries: { tool: entry } };
  const execute = new GithubNpmReleaseDriver('/unused', config, state, async () => {}, async command => {
    if (command[0] === 'fixture-npm') {
      assert.equal(command[1], 'view', 'must not move dist-tags from the local machine');
      if (command[3] !== 'dist-tags') return registry;
      return ++reads > syncedAfter ? '{"latest":"1.1.0","next":"1.1.0"}' : '{"latest":"1.1.0","next":"1.0.0"}';
    }
    const path = command.at(-1)!;
    if (path.includes('contents/')) return JSON.stringify({ encoding: 'base64', content: Buffer.from(JSON.stringify({ name: step.name, version: '1.1.0' })).toString('base64') });
    if (path.includes('/releases/')) return '{"tag_name":"v1.1.0","draft":false,"assets":[]}';
    return JSON.stringify({ object: { type: 'commit', sha } });
  }, async () => {});
  if (syncedAfter === Infinity) await assert.rejects(execute.complete(unchanged, profile, entry), /release\.ymlでlatest\/nextを同期/u);
  else { await execute.complete(unchanged, profile, entry); assert.equal(reads, syncedAfter + 1); }
});

test('a workflow that publishes on the merge push is awaited, not dispatched to race it', async () => {
  const entry = record();
  const configured: ReleaseProfile = { ...profile, publish: { mode: 'dispatch-workflow', workflow: 'release.yml', pushBranches: ['main'] } };
  let reads = 0;
  const execute = driver(async command => {
    if (command[0] === 'fixture-npm') { if (++reads === 1) throw missing(command); return registry; }
    assert.deepEqual(command.slice(0, 2), ['gh', 'api'], 'must not run gh workflow run');
    return JSON.stringify({ workflow_runs: [
      { id: 7, head_sha: 'd'.repeat(40), head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' },
      { id: 42, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' },
    ] });
  }, entry);
  await execute.published(step, configured, entry);
  assert.equal(entry.workflowRun, 42, 'the run of the release merge commit is the one awaited');
  assert.equal(entry.dispatchStartedAt, undefined);
});

test('a version the merge push already published is accepted on resume', async () => {
  const entry = record();
  const configured: ReleaseProfile = { ...profile, publish: { mode: 'dispatch-workflow', workflow: 'release.yml', pushBranches: ['main'] } };
  const execute = driver(async command => {
    if (command[0] === 'fixture-npm') return registry;
    assert.deepEqual(command.slice(0, 2), ['gh', 'api'], 'must not run gh workflow run');
    return JSON.stringify({ workflow_runs: [
      { id: 42, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' },
    ] });
  }, entry);
  await execute.published(step, configured, entry);
  assert.equal(entry.workflowRun, 42);
});

test('prepare-mode rechecks never clean remote branches', async () => {
  const entry = record();
  const state: ExecutionState = { schemaVersion: 1, digest: 'c'.repeat(64), entries: { tool: entry } };
  const execute = new GithubNpmReleaseDriver('/unused', { schemaVersion: 1, repositories: {} }, state,
    async () => {}, async () => { throw new Error('cleanup must not run'); }, async () => {}, { verifyOnly: true });
  await execute.complete({ ...step, action: 'update-only' }, profile, entry);
});
