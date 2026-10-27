import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { GithubNpmReleaseDriver, CommandFailure, runCommand } from '../scripts/lib/release-driver.ts';
import type { Runner } from '../scripts/lib/release-driver.ts';
import { executeReleasePlan, executionDigest } from '../scripts/lib/release-execution.ts';
import type { ExecutionConfig } from '../scripts/lib/release-execution.ts';
import type { ReleasePlan, PackagePlan } from '../scripts/lib/release-plan.ts';

for (const resumedMismatch of [false, true]) test(`pre-existing unpublished tags fail before checkout or publication (resumed mismatch=${resumedMismatch})`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-existing-tag-'));
  try {
    const sha = 'a'.repeat(40);
    const step: PackagePlan = { repo: 'tool', repository: 'family/tool', name: '@family/tool', headSha: sha,
      currentVersion: '1.1.0', publishedVersion: '1.0.0', nextVersion: '1.1.0', versionChange: 'prepared',
      sourceChanges: 'none', action: 'publish', reasons: [], dependencyUpdates: [], issues: [] };
    const profile = { install: [['fixture-install']], verify: [['fixture-verify']], publish: { mode: 'cli' as const, provenance: false } };
    const entry = { phase: 'pending' as const, ...(resumedMismatch ? { mergeCommit: 'b'.repeat(40) } : {}) };
    const runner: Runner = async command => {
      if (command[0] === 'npm') {
        assert.equal(command[1], 'view');
        throw new CommandFailure(command, '{"error":{"code":"E404"}}', 'E404', 1);
      }
      assert.equal(command[0], 'gh', 'must not clone, prepare, tag, or publish');
      assert.equal(command[1], 'api');
      assert(command.includes('GET'), 'only read-only API requests are allowed');
      const path = command.at(-1)!;
      if (path === 'repos/family/tool') return JSON.stringify({ default_branch: 'main', archived: false, permissions: { push: true } });
      assert(path.includes('/git/ref/'));
      return JSON.stringify({ object: { type: 'commit', sha } });
    };
    const execute = new GithubNpmReleaseDriver(root, { schemaVersion: 1, repositories: {} },
      { schemaVersion: 1, digest: 'c'.repeat(64), entries: { tool: entry } }, async () => {}, runner);
    await assert.rejects(execute.preflight(step, profile, entry), resumedMismatch ? /既存タグが再開記録と異なります/ : /既存タグの未公開版補完はexecutorでは未対応/);
    assert.deepEqual(await readdir(root), [], 'preflight must fail before creating a target checkout');
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const privatePackage of [false, true]) for (const interruption of ['none', 'verification', 'main-ci', 'cleanup']) test(`real Git lifecycle with resume (private=${privatePackage}, interruption=${interruption})`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-real-git-'));
  const gitEnv = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Release Test', GIT_AUTHOR_EMAIL: 'release@example.invalid', GIT_COMMITTER_NAME: 'Release Test', GIT_COMMITTER_EMAIL: 'release@example.invalid' };
  const git = (args: string[], cwd?: string) => runCommand(['git', ...args], { cwd, env: gitEnv });
  try {
    const source = join(root, 'source'), remote = join(root, 'remote.git'), workspace = join(root, 'workspace');
    await mkdir(source);
    await git(['init', '--initial-branch=main'], source);
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@family/tool', version: '1.0.0', private: privatePackage, engines: { node: '>=22' } }));
    await writeFile(join(source, 'index.js'), 'export const value = 1;\n');
    await git(['add', '.'], source); await git(['commit', '-m', 'initial'], source);
    const sha = await git(['rev-parse', 'HEAD'], source);
    await git(['clone', '--bare', source, remote]);
    const step: PackagePlan = { repo: 'tool', repository: 'family/tool', name: '@family/tool', headSha: sha,
      currentVersion: '1.0.0', publishedVersion: '1.0.0', nextVersion: '1.1.0', versionChange: 'minor',
      sourceChanges: 'ahead', action: privatePackage ? 'update-only' : 'publish', reasons: ['commits-ahead'], issues: [], dependencyUpdates: [] };
    const plan: ReleasePlan = { schemaVersion: 1, mode: 'plan', ready: true, applyReady: true, target: 'tool',
      snapshot: { generatedAt: '2026-10-26T00:00:00Z', sha256: 'a'.repeat(64) }, order: ['tool'], steps: [step],
      publishTargets: privatePackage ? [] : [{ repository: step.repository, name: step.name!, version: '1.1.0', tag: 'v1.1.0', headSha: sha }] };
    const config: ExecutionConfig = { schemaVersion: 1, workflowTimeoutSeconds: 1, repositories: { 'family/tool': {
      npm: ['fixture-npm'], install: [['fixture-install']], verify: [['fixture-verify']], publish: { mode: 'cli', provenance: false },
      artifacts: ['candidate-{version}.sb3'],
    } } };
    let pr: { number: number; html_url: string; state: string; merged: boolean; merge_commit_sha: string | null; head: { sha: string }; base: { ref: string } } | null = null;
    let release: { id: number; tag_name: string; html_url: string; draft: boolean; assets: { name: string; digest: string }[] } | null = null;
    let published: { name: string; version: string; dist: { shasum: string } } | null = null;
    let packed = '';
    const tags = { latest: '1.0.0', next: '1.0.0' };
    const events: string[] = [];
    let failVerification = interruption === 'verification';
    let failMainCi = interruption === 'main-ci';
    let failCleanup = interruption === 'cleanup';
    const missing = (command: string[]) => new CommandFailure(command, '{"error":{"code":"E404"}}', 'HTTP 404', 1);
    const runner: Runner = async (command, options) => {
      if (command[0] === 'git') {
        if (command[1] === 'push' && command.includes('--delete') && failCleanup) {
          failCleanup = false;
          throw new Error('injected cleanup network failure');
        }
        const rewriting = command[1] === 'remote' && command[2] === 'get-url' ? {} : {
          GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${remote}.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/family/tool.git',
        };
        return runCommand(command, { ...options, env: { ...gitEnv, ...rewriting } });
      }
      if (command[0] === 'fixture-install' || command[0] === 'fixture-verify') {
        assert.equal(JSON.parse(await readFile(join(options!.cwd!, 'package.json'), 'utf8')).version, '1.1.0');
        if (command[0] === 'fixture-verify') {
          assert.equal(await git(['status', '--porcelain'], options!.cwd), '', 'verification requires committed generated outputs');
          if (failVerification) {
            failVerification = false;
            throw new Error('injected verification failure');
          }
        }
        await writeFile(join(options!.cwd!, 'candidate-1.1.0.sb3'), 'verified candidate');
        events.push(command[0]); return '';
      }
      if (command[0] === 'fixture-npm') {
        if (command[1] === 'view') {
          if (command[3] === 'dist-tags') return JSON.stringify(tags);
          if (!published) throw missing(command);
          return JSON.stringify(published);
        }
        if (command[1] === 'pack') {
          const directory = command[command.indexOf('--pack-destination') + 1];
          await mkdir(directory, { recursive: true });
          const bytes = Buffer.from(await readFile(join(options!.cwd!, 'package.json')));
          const filename = 'family-tool-1.1.0.tgz';
          await writeFile(join(directory, filename), bytes);
          packed = createHash('sha1').update(bytes).digest('hex');
          return JSON.stringify({ '@family/tool': { name: '@family/tool', version: '1.1.0', filename, shasum: packed } });
        }
        if (command[1] === 'publish') {
          assert.equal(createHash('sha1').update(await readFile(command[2])).digest('hex'), packed);
          events.push('publish'); published = { name: '@family/tool', version: '1.1.0', dist: { shasum: packed } }; return '';
        }
        if (command[1] === 'dist-tag') {
          const tag = command[4] as 'latest' | 'next'; tags[tag] = '1.1.0'; return '';
        }
      }
      if (command[0] === 'gh' && command[1] === 'api') {
        const path = command.at(-1)!;
        if (path === 'repos/family/tool') return JSON.stringify({ default_branch: 'main', archived: false, permissions: { push: true } });
        if (path.includes('git/ref/heads/')) return JSON.stringify({ object: { sha: await git(['--git-dir', remote, 'rev-parse', 'main']) } });
        if (path.includes('pulls?')) return JSON.stringify(pr ? [pr] : []);
        if (path.includes('/pulls/')) return JSON.stringify(pr);
        if (path.includes('/check-runs?')) {
          const onMain = Boolean(pr?.merge_commit_sha && path.includes(pr.merge_commit_sha));
          if (onMain) events.push('main-ci');
          const conclusion = onMain && failMainCi ? 'failure' : 'success';
          if (onMain) failMainCi = false;
          return JSON.stringify({ total_count: 1, check_runs: [{ status: 'completed', conclusion }] });
        }
        if (path.endsWith('/status')) return '{"statuses":[]}';
        if (path.includes('contents/package.json?ref=')) {
          const content = await git(['--git-dir', remote, 'show', path.split('?ref=')[1] + ':package.json']);
          return JSON.stringify({ encoding: 'base64', content: Buffer.from(content).toString('base64') });
        }
        if (path.includes('git/ref/tags/')) {
          try { return JSON.stringify({ object: { type: 'tag', sha: await git(['--git-dir', remote, 'rev-parse', 'refs/tags/v1.1.0']) } }); }
          catch { throw missing(command); }
        }
        if (path.includes('/git/tags/')) return JSON.stringify({ object: { type: 'commit', sha: (await git(['--git-dir', remote, 'cat-file', '-p', path.split('/').at(-1)!])).split('\n')[0].slice(7) } });
        if (path.includes('/releases/tags/')) { if (!release) throw missing(command); return JSON.stringify(release); }
      }
      if (command[0] === 'gh' && command[1] === 'pr' && command[2] === 'create') {
        const head = await git(['rev-parse', 'HEAD'], join(workspace, 'checkouts/tool'));
        pr = { number: 1, html_url: 'https://github.com/family/tool/pull/1', state: 'open', merged: false, merge_commit_sha: null, head: { sha: head }, base: { ref: 'main' } };
        return pr.html_url;
      }
      if (command[0] === 'gh' && command[1] === 'pr' && command[2] === 'merge') {
        assert(pr);
        const merger = join(root, 'merger'); await git(['clone', remote, merger]);
        await git(['fetch', 'origin'], merger);
        await git(['merge', '--squash', pr.head.sha], merger);
        await git(['commit', '-m', 'squashed release'], merger);
        await git(['push', 'origin', 'main'], merger);
        pr.merge_commit_sha = await git(['rev-parse', 'HEAD'], merger); pr.merged = true; pr.state = 'closed'; return '';
      }
      if (command[0] === 'gh' && command[1] === 'release' && command[2] === 'create') {
        release = { id: 1, tag_name: 'v1.1.0', html_url: 'https://github.com/family/tool/releases/tag/v1.1.0', draft: false, assets: [] }; return '';
      }
      if (command[0] === 'gh' && command[1] === 'release' && command[2] === 'upload') {
        assert(release); release.assets.push({ name: basename(command[4]), digest: 'sha256:' + createHash('sha256').update(await readFile(command[4])).digest('hex') }); return '';
      }
      throw new Error(`Unexpected command (network prohibited): ${command.join(' ')}`);
    };
    const execute = () => executeReleasePlan(plan, config, workspace,
      (save, state) => new GithubNpmReleaseDriver(workspace, config, state, save, runner, async () => {}), executionDigest(plan, config));
    if (interruption !== 'none') {
      const expected = interruption === 'verification' ? /injected verification failure/ : interruption === 'main-ci' ? /main CI/ : /injected cleanup network failure/;
      await assert.rejects(execute(), expected);
      const journal = JSON.parse(await readFile(join(workspace, 'state.json'), 'utf8'));
      if (interruption === 'verification') {
        assert.equal(journal.entries.tool.phase, 'pending');
        assert(journal.entries.tool.commit, 'the clean candidate must be recoverable before verification');
        assert.equal(pr, null, 'failed verification must not push or create a PR');
      }
      if (interruption === 'main-ci') {
        assert.equal(journal.entries.tool.phase, 'pushed');
        assert(!events.includes('publish'), 'failed main CI must prevent publication');
        assert.equal(await git(['--git-dir', remote, 'tag', '--list', 'v1.1.0']), '', 'failed main CI must prevent tagging');
      }
      if (interruption === 'cleanup') {
        assert.equal(journal.entries.tool.phase, 'published');
        assert.equal(await git(['rev-parse', 'HEAD'], join(workspace, 'checkouts/tool')), journal.entries.tool.mergeCommit);
        assert.equal(await git(['branch', '--list', journal.entries.tool.branch], join(workspace, 'checkouts/tool')), '');
      }
    }
    const state = await execute();
    assert.equal(state.entries.tool.phase, 'complete');
    if (!privatePackage) assert.equal(basename(state.entries.tool.extraArtifacts![0].path), 'candidate-1.1.0.sb3');
    assert.equal(tags.latest, privatePackage ? '1.0.0' : '1.1.0'); assert.equal(tags.next, privatePackage ? '1.0.0' : '1.1.0');
    assert.equal(events.filter(event => event === 'publish').length, privatePackage ? 0 : 1);
    if (!privatePackage) assert(events.indexOf('main-ci') < events.indexOf('publish'));
    assert.equal(JSON.parse(await git(['--git-dir', remote, 'show', 'main:package.json'])).version, '1.1.0');
    if (!privatePackage) assert.equal(await git(['--git-dir', remote, 'rev-parse', 'v1.1.0^{commit}']), state.entries.tool.mergeCommit);
    assert.equal(await git(['--git-dir', remote, 'branch', '--list', state.entries.tool.branch!]), '');
    await execute();
    assert.equal(events.filter(event => event === 'publish').length, privatePackage ? 0 : 1, 'resume must not publish again');
  } finally { await rm(root, { recursive: true, force: true }); }
});
