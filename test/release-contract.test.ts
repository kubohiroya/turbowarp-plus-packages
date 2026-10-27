import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { localContractReader, profileFromContract, resolveContracts, trustedConfig } from '../scripts/lib/release-contract.ts';
import { executionDigest } from '../scripts/lib/release-execution.ts';
import { GithubNpmReleaseDriver } from '../scripts/lib/release-driver.ts';
import type { ReleasePlan, PackagePlan } from '../scripts/lib/release-plan.ts';

const manifest = (privatePackage = false) => JSON.stringify({ name: '@family/tool', version: '1.0.0', private: privatePackage, packageManager: 'pnpm@11.11.0',
  scripts: { 'release:prepare': 'node prepare.js', 'release:verify': 'node verify.js' },
  turbowarpRelease: { schemaVersion: 1, publish: { mode: 'dispatch-workflow', workflow: 'release.yml', job: 'publish', inputs: { version: '{version}', shasum: '{shasum}' } } },
});
const workflow = `name: Release
on:
  workflow_dispatch:
    inputs:
      version: { required: true, type: string }
      shasum: { required: true, type: string }
permissions: { contents: read }
jobs:
  publish:
    permissions: { contents: read, id-token: write }
    runs-on: ubuntu-latest
    steps:
      - run: npm publish "$TARBALL" --provenance
`;
function plan(sha = 'a'.repeat(40)): ReleasePlan {
  const step: PackagePlan = { repo: 'tool', repository: 'family/tool', name: '@family/tool', headSha: sha, currentVersion: '1.0.0', publishedVersion: '1.0.0',
    nextVersion: '1.1.0', versionChange: 'minor', sourceChanges: 'ahead', action: 'publish', reasons: ['commits-ahead'], issues: [], dependencyUpdates: [] };
  return { schemaVersion: 1, mode: 'plan', ready: true, applyReady: true, target: 'tool', snapshot: { generatedAt: '2026-10-27T00:00:00Z', sha256: 'b'.repeat(64) },
    order: ['tool'], steps: [step], publishTargets: [{ repository: step.repository, name: step.name!, version: '1.1.0', tag: 'v1.1.0', headSha: sha }] };
}
const reader = (_repo: string, _sha: string, file: string) => file === 'package.json' ? manifest() : workflow;

test('standard contract resolves pinned commands, references, exceptions and digest', () => {
  const p = plan();
  const config = resolveContracts(p, reader);
  assert.equal(config.repositories['family/tool'].publish.mode, 'dispatch-workflow');
  assert.deepEqual(config.repositories['family/tool'].verify, [['corepack', 'pnpm', 'run', 'release:verify']]);
  assert.equal(config.contracts[0].sha, p.steps[0].headSha);
  assert.match(config.contracts[0].files['package.json'], /^[a-f0-9]{64}$/u);
  const exception = resolveContracts(p, reader, { repositories: { 'family/tool': { verify: [['node', 'special-verification.js']] } } });
  assert.notEqual(executionDigest(p, config), executionDigest(p, exception));
  assert.notEqual(executionDigest(p, config), executionDigest(p, resolveContracts(p, (repo, sha, file) => reader(repo, sha, file) + '\n')));
  assert.throws(() => resolveContracts(p, reader, { repositories: { 'family/tool': { publish: { mode: 'cli', provenance: false } } } }), /Trusted Publisher/u);
  assert.throws(() => trustedConfig({ schemaVersion: 1, repositories: { 'family/tool': { ...config.repositories['family/tool'], publish: { mode: 'tag-workflow', workflow: 'other.yml' } } } }), /移行/u);
});

test('missing, ambiguous, token, fixed version and non-OIDC workflows stop before execution', () => {
  for (const invalid of [workflow.replace('id-token: write', 'id-token: read'), workflow.replace('npm publish "$TARBALL"', 'npm publish ./tool-1.0.0.tgz'),
    workflow.replace('--provenance', '--dry-run'), workflow.replace('runs-on:', 'env: { NODE_AUTH_TOKEN: token }\n    runs-on:'),
    workflow.replace('workflow_dispatch:', 'schedule:'), workflow + '\ninvalid: [', workflow.replace('jobs:', 'on: {}\njobs:')]) {
    assert.throws(() => profileFromContract(manifest(), invalid));
  }
  const missing = JSON.parse(manifest()); delete missing.scripts['release:verify'];
  assert.throws(() => profileFromContract(JSON.stringify(missing), workflow), /既存の検証手順/u);
  assert.throws(() => resolveContracts(plan(), () => { throw Error('missing contract'); }), /tool: missing contract/u);
  const privateProfile = profileFromContract(manifest(true), '');
  assert.deepEqual(privateProfile.verify, [['corepack', 'pnpm', 'run', 'release:verify']]);
});

test('workflow selection rejects other publishing jobs that can run in the same event', () => {
  const sibling = (condition = '', permissions = 'id-token: write') => workflow + `
  historical:
    ${condition ? `if: ${condition}` : ''}
    permissions: { ${permissions} }
    runs-on: ubuntu-latest
    steps:
      - run: npm publish ./other-package-1.0.0.tgz --provenance
`;
  // A package-level job hint must not hide another job in the dispatched workflow.
  for (const invalid of [sibling(), sibling("github.event_name == 'workflow_dispatch'"), sibling('', 'contents: read')]) {
    assert.throws(() => profileFromContract(manifest(), invalid), /他の公開job/u);
  }
  for (const unsupported of [
    "github.event_name == 'push' || always()",
    "!(github.event_name == 'workflow_dispatch')",
    "github.event_name != 'workflow_dispatch'",
    "github.event_name == 'push' && !cancelled()",
    "contains('push', github.event_name)",
  ]) assert.throws(() => profileFromContract(manifest(), sibling(unsupported)), /他の公開job/u);
});

test('other publishing jobs are permitted only with provable event exclusion', () => {
  for (const mode of ['tag-workflow', 'dispatch-workflow'] as const) {
    const event = mode === 'tag-workflow' ? 'push' : 'workflow_dispatch';
    const other = event === 'push' ? 'workflow_dispatch' : 'push';
    const metadata = JSON.parse(manifest());
    metadata.turbowarpRelease.publish.mode = mode;
    const separated = workflow
      .replace('  workflow_dispatch:', "  push:\n    tags: ['v*']\n  workflow_dispatch:")
      .replace('  publish:\n', `  publish:\n    if: github.event_name == '${event}'\n`) + `
  historical:
    if: \${{ github.event_name == '${other}' && github.ref == 'refs/heads/main' }}
    runs-on: ubuntu-latest
    steps:
      - run: npm publish ./other-package-1.0.0.tgz
`;
    assert.equal(profileFromContract(JSON.stringify(metadata), separated).publish.mode, mode);
    assert.equal(profileFromContract(JSON.stringify(metadata), separated.replace(
      `\${{ github.event_name == '${other}' && github.ref == 'refs/heads/main' }}`, 'false',
    )).publish.mode, mode);
  }
});

test('existing GitHub workflows need no new declarations; private apps need no publishing workflow', async () => {
  const examples = JSON.parse(await readFile('test/fixtures/release-existing-workflows.json', 'utf8'));
  for (const example of examples) {
    assert.equal(example.manifest.turbowarpRelease, undefined);
    if (['turbowarp-sesame', 'turbowarp-realtime-motion-capture-app'].includes(example.repo)) {
      assert.throws(() => profileFromContract(JSON.stringify(example.manifest), example.workflow), /固定版/u);
    } else {
      const profile = profileFromContract(JSON.stringify(example.manifest), example.workflow);
      assert.equal(profile.publish.mode, 'tag-workflow');
      assert.equal(profile.publish.workflow, 'release.yml');
      assert(profile.verify.some(command => ['check', 'verify:release'].includes(command.at(-1)!)));
    }
  }
});

test('repository workflow example implements the declared dispatch contract', async () => {
  const example = await readFile('docs/release-contract/release.yml.example', 'utf8');
  assert.equal(profileFromContract(manifest(), example).publish.mode, 'dispatch-workflow');
});

test('updated motion-capture and sesame workflows are usable without new declarations', async () => {
  const examples = JSON.parse(await readFile('test/fixtures/release-updated-workflows.json', 'utf8'));
  for (const example of examples) {
    const profile = profileFromContract(JSON.stringify(example.manifest), example.workflow);
    assert.equal(profile.publish.mode, 'tag-workflow');
    assert.equal(profile.publish.workflow, 'release.yml');
    assert.deepEqual(profile.verify, [['corepack', 'pnpm', 'run', 'check']]);
  }
});

test('preflight rejects altered contract sources before any checkout or publication', async () => {
  const p = plan();
  const config = resolveContracts(p, reader);
  const commands: string[][] = [];
  const driver = new GithubNpmReleaseDriver('/unused', config, { schemaVersion: 1, digest: executionDigest(p, config), entries: {} }, async () => {}, async command => {
    commands.push(command);
    assert.equal(command[0], 'gh'); assert.equal(command[1], 'api');
    return JSON.stringify({ encoding: 'base64', content: Buffer.from('changed after approval').toString('base64') });
  });
  await assert.rejects(driver.preflight(p.steps[0], config.repositories['family/tool'], { phase: 'pending' }), /契約が承認時と異なります/u);
  assert.equal(commands.length, 1);
});

test('discovery and saved dry-run work offline without modifying repo/workspace or re-resolving', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-contract-'));
  try {
    const repo = join(root, 'tool'); await mkdir(join(repo, '.github/workflows'), { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('init', '--quiet'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@localhost');
    const existing = JSON.parse(manifest());
    delete existing.turbowarpRelease;
    existing.scripts = { build: 'node prepare.js', check: 'node verify.js' };
    await writeFile(join(repo, 'package.json'), JSON.stringify(existing)); await writeFile(join(repo, '.github/workflows/release.yml'), workflow);
    git('add', '.'); git('commit', '--quiet', '-m', 'contract'); const sha = git('rev-parse', 'HEAD');
    const p = plan(sha), planFile = join(root, 'plan.json'), approved = join(root, 'approved.json');
    await writeFile(planFile, JSON.stringify(p));
    // Dirty working files are intentionally ignored by immutable-source discovery.
    await writeFile(join(repo, 'package.json'), '{}');
    assert.deepEqual(resolveContracts(p, localContractReader(root)).repositories['family/tool'].prepare, [['corepack', 'pnpm', 'run', 'build']]);
    const before = git('status', '--porcelain');
    const args = ['--import', 'tsx', resolve('scripts/release.ts'), '--plan', planFile, '--workspace', join(root, 'execution')];
    const invoke = (extra: string[]) => spawnSync(process.execPath, [...args, ...extra], { encoding: 'utf8' });
    const initial = invoke(['--discover', '--repos-dir', root]); assert.equal(initial.status, 0, initial.stderr);
    const preview = JSON.parse(initial.stdout); await writeFile(approved, initial.stdout);
    // Saved settings do not need the local repositories to resolve again.
    const resumed = invoke(['--resolved', approved]); assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).digest, preview.digest);
    preview.effectiveConfig.repositories['family/tool'].verify.push(['node', 'changed.js']);
    await writeFile(approved, JSON.stringify(preview));
    const changed = invoke(['--resolved', approved]); assert.notEqual(changed.status, 0); assert.match(changed.stderr, /digest/u);
    assert.equal(git('status', '--porcelain'), before);
    assert.deepEqual((await readdir(root)).sort(), ['approved.json', 'plan.json', 'tool']);
    assert.equal((await readFile(join(repo, 'package.json'), 'utf8')), '{}');
  } finally { await rm(root, { recursive: true, force: true }); }
});
