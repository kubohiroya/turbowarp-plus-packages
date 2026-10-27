import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommandFailure, GithubNpmReleaseDriver } from '../scripts/lib/release-driver.ts';
import type { Runner } from '../scripts/lib/release-driver.ts';
import type { ExecutionConfig, ExecutionEntry, ExecutionState, ReleaseProfile } from '../scripts/lib/release-execution.ts';
import type { PackagePlan } from '../scripts/lib/release-plan.ts';

const sha = 'a'.repeat(40), shasum = 'b'.repeat(40);
const step: PackagePlan = { repo: 'tool', repository: 'family/tool', name: '@family/tool', headSha: sha,
  currentVersion: '1.0.0', publishedVersion: '1.0.0', nextVersion: '1.1.0', versionChange: 'minor', action: 'publish',
  sourceChanges: 'ahead', reasons: ['commits-ahead'], dependencyUpdates: [], issues: [] };
const profile: ReleaseProfile = { npm: ['fixture-npm'], install: [['fixture-install']], verify: [['fixture-verify']], publish: { mode: 'cli', provenance: false } };
const registry = JSON.stringify({ name: step.name, version: '1.1.0', dist: { shasum } });
const missing = (command: string[]) => new CommandFailure(command, '{"error":{"code":"E404"}}', 'E404', 1);
const record = (): ExecutionEntry => ({ phase: 'released', mergeCommit: sha, shasum, artifact: '/unused/test.tgz', base: 'main' });
function driver(run: Runner, entry: ExecutionEntry, save = async () => {}) {
  const config: ExecutionConfig = { schemaVersion: 1, workflowTimeoutSeconds: 20, repositories: {} };
  const state: ExecutionState = { schemaVersion: 1, digest: 'c'.repeat(64), entries: { tool: entry } };
  return new GithubNpmReleaseDriver('/unused', config, state, save, run, async () => {});
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

test('tag workflow selection ignores runs for main and requires the exact publication job to succeed', async () => {
  const entry = record(); let reads = 0;
  const configured: ReleaseProfile = { ...profile, publish: { mode: 'tag-workflow', workflow: 'release.yml' } };
  const execute = driver(async command => {
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
