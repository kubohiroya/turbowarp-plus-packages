import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_TARGETS, formatPins, formatReport, mergeFork, mirrorPin, newState, parseVmDependency, planVerification,
  publishCandidate, runVerification, spawnRunner, stepEnv, updatePins,
  type ForkTarget, type Runner, type StepPlan, type SyncOptions, type SyncState,
} from '../scripts/lib/upstream-sync.ts';

const sha = (c: string) => c.repeat(40);

for (const key of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) process.env[key] = 'test';
for (const key of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) process.env[key] = 'test@example.invalid';

test('updatePins keeps key order and lists only changed revisions', () => {
  const before = { guiRepository: 'kubohiroya/scratch-gui', guiRevision: sha('a'), vmRevision: sha('b'), vmBaseRevision: sha('c'), packagerRevision: sha('d'), extra: 1 };
  const { after, changes } = updatePins(before, { guiRevision: sha('e'), vmRevision: sha('b'), vmBaseRevision: sha('c'), packagerRevision: sha('f') });
  assert.deepEqual(Object.keys(after), Object.keys(before));
  assert.deepEqual(changes, [
    { key: 'guiRevision', from: sha('a'), to: sha('e') },
    { key: 'packagerRevision', from: sha('d'), to: sha('f') },
  ]);
  assert.equal(formatPins(after).endsWith('}\n'), true);
  assert.throws(() => updatePins(before, { guiRevision: 'develop', vmRevision: sha('b'), vmBaseRevision: sha('c'), packagerRevision: sha('d') }), /40桁SHA/);
});

test('parseVmDependency reads the git pin the GUI uses for scratch-vm', () => {
  assert.deepEqual(parseVmDependency(`git+https://github.com/kubohiroya/scratch-vm.git#${sha('1')}`),
    { repository: 'kubohiroya/scratch-vm', revision: sha('1') });
  assert.throws(() => parseVmDependency('^5.0.0'), /scratch-vm/);
});

test('stepEnv never carries the real-mouse E2E switches into a step', () => {
  const env = stepEnv({ E2E_GUI_ROOT: '/gui' }, { PATH: '/bin', TW_PLUS_NATIVE_INPUT: '1', E2E_NATIVE: '1', CI: 'true' });
  assert.deepEqual(env, { PATH: '/bin', E2E_GUI_ROOT: '/gui' });
});

function candidateState(vmStatus: 'up-to-date' | 'merged'): SyncState {
  const fork = (name: 'scratch-vm' | 'scratch-gui', status: 'up-to-date' | 'merged') => ({
    name, upstream: sha('u'), origin: sha('o'), behind: status === 'merged' ? 3 : 0, ahead: 1, upstreamFiles: 2,
    status, conflicts: [], candidate: sha(name === 'scratch-vm' ? '1' : '2'), branch: status === 'merged' ? 'chore/upstream/merge-x' : null,
    worktree: `/work/${name}`,
  });
  return {
    id: 'x', createdAt: '', workDir: '/work', forks: { vm: fork('scratch-vm', vmStatus), gui: fork('scratch-gui', 'merged') },
    packager: { pinned: sha('d'), latest: sha('f') }, guiVm: { repository: 'kubohiroya/scratch-vm', revision: sha('b') },
    pins: { before: {}, after: { packagerRevision: sha('f') }, changes: [{ key: 'packagerRevision', from: sha('d'), to: sha('f') }] },
    editor: { worktree: '/work/editor', branch: 'chore/upstream/sync-x', base: sha('9'), head: sha('3') },
    steps: [], notes: [], published: [],
  };
}

test('planVerification follows CI and adds browser steps only with --e2e', () => {
  const plan = planVerification(candidateState('up-to-date'), { e2e: false, relocationUpstream: sha('r'), guiUpstream: 'u' });
  const names = plan.map((step) => step.name);
  assert.ok(!names.some((name) => name.startsWith('vm:')), 'an unchanged VM is not tested again');
  assert.ok(!names.includes('gui:integration') && !names.includes('editor:e2e'));
  assert.ok(names.indexOf('editor:install') < names.indexOf('editor:build'));
  const build = plan.find((step) => step.name === 'editor:build')!;
  assert.equal(build.env?.E2E_GUI_ROOT, '/work/scratch-gui');
  assert.equal(build.env?.TW_PLUS_PACKAGER_ROOT, '/work/packager');
  assert.ok(plan.find((step) => step.name === 'editor:gui-integration')!.needs.includes('gui:relocation-base'));

  const full = planVerification(candidateState('merged'), { e2e: true, relocationUpstream: null, guiUpstream: 'u' }).map((step) => step.name);
  assert.ok(full.includes('vm:test') && full.includes('gui:integration') && full.includes('editor:e2e'));
  assert.ok(!full.includes('gui:relocation-base'));
});

function options(runner: Runner, extra: Partial<SyncOptions> = {}): SyncOptions {
  return {
    reposDir: '/repos', workRoot: '/work', id: 'x', e2e: false, mergeOnly: false,
    targets: DEFAULT_TARGETS, runner, log: () => {}, ...extra,
  };
}

test('runVerification skips dependents of a failure and reuses earlier successes once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'upstream-sync-'));
  try {
    const state = { ...candidateState('up-to-date'), workDir: dir };
    const plan: StepPlan[] = [
      { name: 'a:install', cwd: dir, command: 'a', args: [], needs: [], inputs: 'a1' },
      { name: 'a:test', cwd: dir, command: 'a-test', args: [], needs: ['a:install'], inputs: 'a1' },
      { name: 'b:install', cwd: dir, command: 'b', args: [], needs: [], inputs: 'b1' },
      { name: 'b:test', cwd: dir, command: 'b-test', args: [], needs: ['b:install'], inputs: 'b1' },
    ];
    const calls: string[] = [];
    const runner: Runner = async (command) => {
      calls.push(command);
      return { code: command === 'b' ? 1 : 0, stdout: '', stderr: command === 'b' ? 'boom' : '' };
    };
    await runVerification(options(runner), state, plan);
    assert.deepEqual(calls, ['a', 'a-test', 'b']);
    assert.deepEqual(state.steps.map((step) => step.status), ['ok', 'ok', 'failed', 'skipped']);
    assert.match(state.steps[2].tail!, /boom/);

    calls.length = 0;
    plan[2].inputs = plan[3].inputs = 'b2';
    const fixed: Runner = async (command) => { calls.push(command); return { code: 0, stdout: '', stderr: '' }; };
    await runVerification(options(fixed), state, plan);
    assert.deepEqual(calls, ['b', 'b-test'], 'unchanged successes are not run again');
    assert.deepEqual(state.steps.map((step) => step.reused ?? false), [true, true, false, false]);
    assert.match(formatReport(state), /a:install \| 成功（前回の結果）/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** 本家とフォーク（どちらも bare）を作り、それぞれに1コミットずつ足す。 */
async function forkFixture(conflict: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'upstream-sync-git-'));
  const seed = join(root, 'seed');
  sh(root, 'init', '--quiet', '-b', 'develop', seed);
  await writeFile(join(seed, 'a.txt'), 'base\n');
  sh(seed, 'add', '.');
  sh(seed, 'commit', '--quiet', '-m', 'base');
  sh(root, 'clone', '--quiet', '--bare', seed, join(root, 'upstream.git'));
  sh(root, 'clone', '--quiet', '--bare', seed, join(root, 'fork.git'));
  const edit = async (bare: string, file: string, text: string) => {
    const work = join(root, `edit-${bare}-${file}`);
    sh(root, 'clone', '--quiet', join(root, bare), work);
    await writeFile(join(work, file), text);
    sh(work, 'add', '.');
    sh(work, 'commit', '--quiet', '-m', `${bare} ${file}`);
    sh(work, 'push', '--quiet', 'origin', 'develop');
  };
  await edit('upstream.git', 'a.txt', 'upstream\n');
  await edit('fork.git', conflict ? 'a.txt' : 'b.txt', 'fork\n');
  const target: ForkTarget = {
    ...DEFAULT_TARGETS.gui, origin: join(root, 'fork.git'), upstream: join(root, 'upstream.git'), pushUrl: join(root, 'fork.git'),
  };
  sh(root, 'clone', '--quiet', target.origin, join(root, 'repos', 'scratch-gui'));
  const opts = options(spawnRunner, { reposDir: join(root, 'repos'), workRoot: join(root, 'work') });
  return { root, target, opts, workDir: join(root, 'work', 'x') };
}

test('mergeFork merges upstream develop into a fresh branch off the fork develop', async () => {
  const { root, target, opts, workDir } = await forkFixture(false);
  try {
    const result = await mergeFork(opts, target, workDir);
    assert.equal(result.status, 'merged');
    assert.equal(result.behind, 1);
    assert.equal(result.ahead, 1);
    assert.equal(result.upstreamFiles, 1);
    assert.equal(result.branch, 'chore/upstream/merge-x');
    assert.equal(sh(result.worktree, 'rev-parse', 'HEAD'), result.candidate);
    assert.equal(await readFile(join(result.worktree, 'a.txt'), 'utf8'), 'upstream\n');
    assert.equal(sh(target.origin, 'rev-parse', 'develop'), result.origin, 'nothing is pushed');
    // 同じ id でもう一度走らせても、同じ候補を返す。
    assert.equal((await mergeFork(opts, target, workDir)).candidate, result.candidate);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('mergeFork stops on conflicts and resumes after they are committed', async () => {
  const { root, target, opts, workDir } = await forkFixture(true);
  try {
    const first = await mergeFork(opts, target, workDir);
    assert.equal(first.status, 'conflict');
    assert.deepEqual(first.conflicts, ['a.txt']);
    assert.equal(first.candidate, null);
    assert.match(formatReport({ ...(await newState(workDir, 'x')), forks: { vm: null, gui: first } }), /- `a.txt`/);

    assert.equal((await mergeFork(opts, target, workDir)).status, 'conflict', 'an unresolved merge stays a conflict');
    await writeFile(join(first.worktree, 'a.txt'), 'resolved\n');
    sh(first.worktree, 'add', 'a.txt');
    sh(first.worktree, 'commit', '--quiet', '--no-edit');
    const resumed = await mergeFork(opts, target, workDir);
    assert.equal(resumed.status, 'merged');
    assert.equal(resumed.candidate, sh(first.worktree, 'rev-parse', 'HEAD'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('publishCandidate refuses an unverified candidate and pushes nothing when declined', async () => {
  const calls: string[] = [];
  const runner: Runner = async (command, args) => { calls.push(`${command} ${args.join(' ')}`); return { code: 0, stdout: '', stderr: '' }; };
  const state = candidateState('up-to-date');
  await assert.rejects(publishCandidate(options(runner), state, async () => true), /検証が全件成功していない/);

  const dir = await mkdtemp(join(tmpdir(), 'upstream-sync-'));
  try {
    const verifiedState: SyncState = { ...state, workDir: dir, steps: [{ name: 'a', status: 'ok', inputs: '', seconds: 0, log: null }] };
    const questions: string[] = [];
    await publishCandidate(options(runner), verifiedState, async (question) => { questions.push(question); return false; });
    assert.equal(questions.length, 1);
    assert.match(questions[0], /scratch-gui/);
    assert.deepEqual(calls, []);
    assert.deepEqual(verifiedState.published, []);
    assert.match(verifiedState.notes.join('\n'), /見送りました/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mirrorPin rewrites the tracked copies of a pin outside source.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'upstream-sync-mirror-'));
  try {
    sh(root, 'init', '--quiet');
    await writeFile(join(root, 'build.cts'), `if (revision !== '${sha('d')}') throw new Error();\n`);
    await writeFile(join(root, 'other.txt'), 'nothing here\n');
    await import('node:fs/promises').then((fs) => fs.mkdir(join(root, 'site')));
    await writeFile(join(root, 'site/source.json'), `{"packagerRevision": "${sha('d')}"}\n`);
    sh(root, 'add', '.');
    sh(root, 'commit', '--quiet', '-m', 'seed');
    assert.deepEqual(await mirrorPin(spawnRunner, root, sha('d'), sha('f')), ['build.cts']);
    assert.match(await readFile(join(root, 'build.cts'), 'utf8'), new RegExp(sha('f')));
    assert.match(await readFile(join(root, 'site/source.json'), 'utf8'), new RegExp(sha('d')), 'source.json is written by updatePins');
    assert.equal(sh(root, 'diff', '--cached', '--name-only'), 'build.cts');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
