/**
 * 本家追従: フォーク（scratch-vm / scratch-gui）へ本家 develop をマージした候補を作り、
 * Packager の固定値と合わせて TurboWarp Plus Editor の `site/source.json` を書き換え、
 * CI と同じ順で検証して結果をまとめる。
 *
 * フォークにも plus-editor にもコードを足さない方針なので、手順はすべてここに置き、
 * 各リポジトリは `<repos-dir>/<repo名>` の checkout から worktree を切って操作する。
 * push と PR の作成は `publish` だけが行い、1件ずつ確認を取る。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// 設定

export interface ForkTarget {
  /** checkout のディレクトリ名。`<repos-dir>/<name>` に無ければ作業ディレクトリへ clone する。 */
  name: 'scratch-vm' | 'scratch-gui';
  /** GitHub の owner/repo。PR の作成先。 */
  repository: string;
  origin: string;
  /** push 先。既定は SSH。 */
  pushUrl: string;
  upstream: string;
  upstreamRepository: string;
  branch: string;
}

export interface SyncTargets {
  vm: ForkTarget;
  gui: ForkTarget;
  packager: { url: string; branch: string };
  editor: { name: string; repository: string; origin: string; pushUrl: string; branch: string };
}

export const DEFAULT_TARGETS: SyncTargets = {
  vm: {
    name: 'scratch-vm', repository: 'kubohiroya/scratch-vm',
    origin: 'https://github.com/kubohiroya/scratch-vm.git', pushUrl: 'git@github.com:kubohiroya/scratch-vm.git',
    upstream: 'https://github.com/TurboWarp/scratch-vm.git', upstreamRepository: 'TurboWarp/scratch-vm', branch: 'develop',
  },
  gui: {
    name: 'scratch-gui', repository: 'kubohiroya/scratch-gui',
    origin: 'https://github.com/kubohiroya/scratch-gui.git', pushUrl: 'git@github.com:kubohiroya/scratch-gui.git',
    upstream: 'https://github.com/TurboWarp/scratch-gui.git', upstreamRepository: 'TurboWarp/scratch-gui', branch: 'develop',
  },
  packager: { url: 'https://github.com/TurboWarp/packager.git', branch: 'master' },
  editor: {
    name: 'turbowarp-plus-editor', repository: 'kubohiroya/turbowarp-plus-editor',
    origin: 'https://github.com/kubohiroya/turbowarp-plus-editor.git',
    pushUrl: 'git@github.com:kubohiroya/turbowarp-plus-editor.git', branch: 'main',
  },
};

export interface SyncOptions {
  reposDir: string;
  /** 候補ごとのディレクトリの親。既定は `<repos-dir>/.upstream-sync`。 */
  workRoot: string;
  /** 候補の名前。ブランチ名と作業ディレクトリ名に使う。既定は実行日。 */
  id: string;
  /** フォーク側の結合テスト（ブラウザー）と plus-editor の Playwright E2E も走らせる。 */
  e2e: boolean;
  /** マージと固定値の書き換えまでで止め、検証しない。 */
  mergeOnly: boolean;
  targets: SyncTargets;
  runner: Runner;
  log: (line: string) => void;
}

// ---------------------------------------------------------------------------
// コマンド実行

export interface RunResult { code: number; stdout: string; stderr: string }
export interface RunOptions { cwd: string; env?: NodeJS.ProcessEnv; logFile?: string }
export type Runner = (command: string, args: string[], options: RunOptions) => Promise<RunResult>;

const TAIL = 4000;

/** 出力を捕まえる。`logFile` があれば全出力をそこへ書き、戻り値には末尾だけを残す。 */
export const spawnRunner: Runner = (command, args, { cwd, env, logFile }) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const file = logFile ? createWriteStream(logFile) : null;
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    file?.write(chunk);
    stdout = file ? (stdout + chunk.toString()).slice(-TAIL) : stdout + chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    file?.write(chunk);
    stderr = file ? (stderr + chunk.toString()).slice(-TAIL) : stderr + chunk.toString();
  });
  child.on('error', reject);
  child.on('close', (code) => {
    const done = () => resolve({ code: code ?? 1, stdout, stderr });
    if (file) file.end(done); else done();
  });
});

async function git(runner: Runner, cwd: string, ...args: string[]): Promise<string> {
  const result = await runner('git', args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} が失敗しました (${cwd}):\n${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

async function gitOk(runner: Runner, cwd: string, ...args: string[]): Promise<boolean> {
  return (await runner('git', args, { cwd })).code === 0;
}

// ---------------------------------------------------------------------------
// 固定値

export const SHA = /^[0-9a-f]{40}$/;
export const PIN_KEYS = ['guiRevision', 'vmRevision', 'vmBaseRevision', 'packagerRevision'] as const;
export type PinKey = typeof PIN_KEYS[number];
export type Pins = Record<string, unknown> & Partial<Record<PinKey, string>>;
export interface PinChange { key: PinKey; from: string | undefined; to: string }

/** キーの順番を保ったまま固定値を差し替え、変わったものを返す。 */
export function updatePins(before: Pins, next: Record<PinKey, string>): { after: Pins; changes: PinChange[] } {
  const after: Pins = { ...before };
  const changes: PinChange[] = [];
  for (const key of PIN_KEYS) {
    if (!SHA.test(next[key])) throw new Error(`${key} の候補が40桁SHAではありません: ${next[key]}`);
    if (before[key] !== next[key]) changes.push({ key, from: before[key], to: next[key] });
    after[key] = next[key];
  }
  return { after, changes };
}

export const formatPins = (pins: Pins): string => `${JSON.stringify(pins, null, 2)}\n`;

const VM_DEPENDENCY = /^git\+https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)\.git#([0-9a-f]{40})$/;

/** scratch-gui の `package.json` にある scratch-vm の指定から、リポジトリと SHA を取り出す。 */
export function parseVmDependency(spec: unknown): { repository: string; revision: string } {
  const match = typeof spec === 'string' ? VM_DEPENDENCY.exec(spec) : null;
  if (!match) throw new Error(`scratch-vm の依存指定を読めません: ${String(spec)}`);
  return { repository: match[1], revision: match[2] };
}

export const vmDependency = (repository: string, revision: string): string =>
  `git+https://github.com/${repository}.git#${revision}`;

// ---------------------------------------------------------------------------
// 状態

export type MergeStatus = 'up-to-date' | 'merged' | 'conflict';

export interface ForkResult {
  name: ForkTarget['name'];
  upstream: string;
  origin: string;
  /** フォーク develop に無い本家コミットの数。 */
  behind: number;
  /** 本家に無いフォークのコミットの数。 */
  ahead: number;
  /** 本家側で変わったファイルの数（merge-base から本家先頭まで）。 */
  upstreamFiles: number;
  status: MergeStatus;
  conflicts: string[];
  /** 候補の先頭。衝突中は null。 */
  candidate: string | null;
  branch: string | null;
  worktree: string;
}

export type StepStatus = 'ok' | 'failed' | 'skipped';
export interface StepResult {
  name: string;
  status: StepStatus;
  /** この入力で一度成功していれば再実行しない。 */
  inputs: string;
  seconds: number;
  log: string | null;
  reused?: boolean;
  tail?: string;
}

export interface PublishRecord { action: string; result: string }

export interface SyncState {
  id: string;
  createdAt: string;
  workDir: string;
  forks: { vm: ForkResult | null; gui: ForkResult | null };
  packager: { pinned: string | undefined; latest: string };
  /** GUI が依存する scratch-vm。 */
  guiVm: { repository: string; revision: string } | null;
  pins: { before: Pins; after: Pins; changes: PinChange[] } | null;
  editor: { worktree: string; branch: string; base: string; head: string | null } | null;
  steps: StepResult[];
  notes: string[];
  published: PublishRecord[];
}

const statePath = (workDir: string) => join(workDir, 'state.json');

export async function readState(workDir: string): Promise<SyncState | null> {
  try {
    return JSON.parse(await readFile(statePath(workDir), 'utf8')) as SyncState;
  } catch {
    return null;
  }
}

export async function writeState(state: SyncState): Promise<void> {
  await writeFile(statePath(state.workDir), `${JSON.stringify(state, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// checkout と fetch

/** `<repos-dir>/<name>` を使う。無ければ作業ディレクトリへ clone し、次回からそれを使う。 */
export async function resolveCheckout(options: SyncOptions, name: string, origin: string): Promise<string> {
  const local = join(options.reposDir, name);
  if (existsSync(join(local, '.git'))) return local;
  const cached = join(options.workRoot, 'repos', name);
  if (!existsSync(join(cached, '.git'))) {
    await mkdir(join(options.workRoot, 'repos'), { recursive: true });
    options.log(`${name}: checkout が無いので ${cached} へ clone します`);
    await git(options.runner, options.workRoot, 'clone', '--no-checkout', '--filter=blob:none', origin, cached);
  }
  return cached;
}

/**
 * リモート名に頼らず URL から取得し、`refs/upstream-sync/*` に置く。
 * 利用者の checkout のリモート設定や追跡ブランチは変えない。
 */
async function fetchRef(runner: Runner, repo: string, url: string, branch: string, as: string): Promise<string> {
  const ref = `refs/upstream-sync/${as}`;
  await git(runner, repo, 'fetch', '--no-tags', '--quiet', url, `+refs/heads/${branch}:${ref}`);
  return git(runner, repo, 'rev-parse', ref);
}

export async function lsRemote(runner: Runner, cwd: string, url: string, branch: string): Promise<string> {
  const out = await git(runner, cwd, 'ls-remote', '--exit-code', url, `refs/heads/${branch}`);
  const sha = out.split(/\s+/)[0];
  if (!SHA.test(sha)) throw new Error(`${url} の ${branch} を解決できません`);
  return sha;
}

// ---------------------------------------------------------------------------
// フォークのマージ

export const forkBranch = (id: string) => `chore/upstream/merge-${id}`;
export const editorBranch = (id: string) => `chore/upstream/sync-${id}`;

async function unmergedFiles(runner: Runner, worktree: string): Promise<string[]> {
  const out = await git(runner, worktree, 'diff', '--name-only', '--diff-filter=U');
  return out ? out.split('\n') : [];
}

/**
 * フォーク develop から追従ブランチを切り、本家 develop をマージする。
 * 衝突したら worktree をそのまま残す。手で解決してコミットしたあと、同じ候補で再実行すると続きから進む。
 */
export async function mergeFork(options: SyncOptions, fork: ForkTarget, workDir: string): Promise<ForkResult> {
  const { runner, log } = options;
  const repo = await resolveCheckout(options, fork.name, fork.origin);
  const origin = await fetchRef(runner, repo, fork.origin, fork.branch, `${fork.name}/origin`);
  const upstream = await fetchRef(runner, repo, fork.upstream, fork.branch, `${fork.name}/upstream`);
  const count = async (range: string) => Number(await git(runner, repo, 'rev-list', '--count', range));
  const behind = await count(`${origin}..${upstream}`);
  const ahead = await count(`${upstream}..${origin}`);
  const changed = await git(runner, repo, 'diff', '--name-only', `${origin}...${upstream}`);
  const upstreamFiles = changed ? changed.split('\n').length : 0;
  const worktree = join(workDir, fork.name);
  const base = { name: fork.name, upstream, origin, behind, ahead, upstreamFiles, worktree };

  if (behind === 0) {
    if (!existsSync(worktree)) await git(runner, repo, 'worktree', 'add', '--detach', worktree, origin);
    log(`${fork.name}: 本家との差はありません（フォーク develop ${origin.slice(0, 9)}）`);
    return { ...base, status: 'up-to-date', conflicts: [], candidate: await git(runner, worktree, 'rev-parse', 'HEAD'), branch: null };
  }

  const branch = forkBranch(options.id);
  if (!existsSync(worktree)) {
    if (await gitOk(runner, repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)) {
      throw new Error(`${fork.name}: ブランチ ${branch} が既にあります。別の --id を指定するか、ブランチを消してください。`);
    }
    await git(runner, repo, 'worktree', 'add', '-b', branch, worktree, origin);
    log(`${fork.name}: 本家の ${behind} コミットをマージします`);
    const message = `chore(upstream): 本家 ${fork.upstreamRepository} の ${fork.branch} を取り込む`;
    const merge = await runner('git', ['merge', '--no-ff', '--no-edit', '-m', message, upstream], { cwd: worktree });
    if (merge.code !== 0) {
      const conflicts = await unmergedFiles(runner, worktree);
      if (conflicts.length === 0) throw new Error(`${fork.name}: マージが失敗しました:\n${merge.stderr.trim()}`);
      log(`${fork.name}: ${conflicts.length} ファイルで衝突しました。${worktree} で解決してコミットしてください`);
      return { ...base, status: 'conflict', conflicts, candidate: null, branch };
    }
  }

  // 再実行: 前回のマージの続き。
  const conflicts = await unmergedFiles(runner, worktree);
  if (conflicts.length > 0 || existsSync(join(await git(runner, worktree, 'rev-parse', '--git-dir'), 'MERGE_HEAD'))) {
    log(`${fork.name}: まだ解決していないマージがあります（${worktree}）`);
    return { ...base, status: 'conflict', conflicts, candidate: null, branch };
  }
  const head = await git(runner, worktree, 'rev-parse', 'HEAD');
  if (!(await gitOk(runner, worktree, 'merge-base', '--is-ancestor', upstream, head))) {
    throw new Error(`${fork.name}: ${worktree} の先頭が本家 ${upstream.slice(0, 9)} を含みません。worktree を確認してください。`);
  }
  return { ...base, status: 'merged', conflicts: [], candidate: head, branch };
}

// ---------------------------------------------------------------------------
// plus-editor の候補

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

/**
 * `site/source.json` のほかにも同じ SHA を直書きしている固定値。
 * Packager はビルドスクリプトと文書が自分で照合するので、旧値を同じ新値に揃える。
 */
export const MIRRORED_PINS: readonly PinKey[] = ['packagerRevision'];

/** 追跡されているファイルの旧 SHA を新 SHA に置き換え、書き換えたファイルを返す。 */
export async function mirrorPin(runner: Runner, worktree: string, from: string, to: string): Promise<string[]> {
  const found = await runner('git', ['grep', '-l', '--fixed-strings', from, '--', '.', ':!site/source.json'], { cwd: worktree });
  const files = found.code === 0 && found.stdout.trim() ? found.stdout.trim().split('\n') : [];
  for (const name of files) {
    const path = join(worktree, name);
    await writeFile(path, (await readFile(path, 'utf8')).split(from).join(to));
    await git(runner, worktree, 'add', '--', name);
  }
  return files;
}

/** plus-editor の worktree を用意し、固定値を書き換えてローカルにコミットする（push しない）。 */
export async function prepareEditor(
  options: SyncOptions, state: SyncState, next: Record<PinKey, string>,
): Promise<void> {
  const { runner } = options;
  const target = options.targets.editor;
  const worktree = join(state.workDir, 'editor');
  const branch = editorBranch(options.id);
  if (!state.editor) {
    const repo = await resolveCheckout(options, target.name, target.origin);
    const base = await fetchRef(runner, repo, target.origin, target.branch, `${target.name}/origin`);
    if (!existsSync(worktree)) {
      if (await gitOk(runner, repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)) {
        throw new Error(`plus-editor: ブランチ ${branch} が既にあります。別の --id を指定するか、ブランチを消してください。`);
      }
      await git(runner, repo, 'worktree', 'add', '-b', branch, worktree, base);
    }
    state.editor = { worktree, branch, base, head: null };
  }
  const file = join(worktree, 'site/source.json');
  const current = await readJson<Pins>(file);
  const before = state.pins?.before ?? current;
  const { after, changes } = updatePins(before, next);
  state.pins = { before, after, changes };
  if (formatPins(current) !== formatPins(after)) {
    await writeFile(file, formatPins(after));
    await git(runner, worktree, 'add', 'site/source.json');
    for (const change of changes.filter((item) => MIRRORED_PINS.includes(item.key) && item.from && current[item.key] === item.from)) {
      const mirrored = await mirrorPin(runner, worktree, change.from!, change.to);
      if (mirrored.length > 0) state.notes.push(`${change.key} の写し ${mirrored.map((name) => `\`${name}\``).join('、')} も書き換えました。`);
    }
    const keys = changes.map((change) => change.key).join(', ');
    await git(runner, worktree, 'commit', '--quiet', '-m', `chore(deps): 本家追従の固定値を更新する\n\n${keys}`);
  }
  state.editor.head = await git(runner, worktree, 'rev-parse', 'HEAD');
}

// ---------------------------------------------------------------------------
// 検証

export interface StepPlan {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** 先に成功している必要がある手順。 */
  needs: string[];
  /** 入力が同じなら前回の成功を使う。 */
  inputs: string;
}

const npm = (name: string, cwd: string, script: string[], needs: string[], inputs: string, env?: NodeJS.ProcessEnv): StepPlan =>
  ({ name, cwd, command: 'npm', args: script, needs, inputs, env });

/**
 * CI（plus-editor の `.github/workflows/ci.yml`）と同じ順の検証手順。
 * ブラウザーを使うものは `e2e` のときだけ入れる。実マウスの E2E は入れない。
 */
export function planVerification(state: SyncState, options: Pick<SyncOptions, 'e2e'> & { relocationUpstream: string | null; guiUpstream: string }): StepPlan[] {
  const steps: StepPlan[] = [];
  const vm = state.forks.vm;
  const gui = state.forks.gui;
  const editor = state.editor;
  if (!gui?.candidate || !editor?.head) throw new Error('GUI と plus-editor の候補が揃っていません');
  const vmIn = `vm:${vm?.candidate}`;
  const guiIn = `gui:${gui.candidate}`;
  const packager = join(state.workDir, 'packager');
  const editorIn = `${guiIn} editor:${editor.head} packager:${state.pins?.after.packagerRevision}`;
  const install = ['ci', '--no-audit', '--no-fund'];

  if (vm?.status === 'merged' && vm.candidate) {
    steps.push(npm('vm:install', vm.worktree, install, [], vmIn));
    steps.push(npm('vm:test', vm.worktree, ['test'], ['vm:install'], vmIn));
  }
  steps.push(npm('gui:install', gui.worktree, install, [], guiIn));
  steps.push({ name: 'gui:prepublish', cwd: gui.worktree, command: 'node', args: ['scripts/prepublish.mjs'], needs: ['gui:install'], inputs: guiIn });
  if (options.relocationUpstream) {
    // test:gui-integration は移設元の本家コミットと比べるので、その版が checkout に要る。
    steps.push({
      name: 'gui:relocation-base', cwd: gui.worktree, command: 'git',
      args: ['fetch', '--no-tags', '--quiet', options.guiUpstream, options.relocationUpstream], needs: [], inputs: `${guiIn} ${options.relocationUpstream}`,
    });
  }
  steps.push(npm('gui:lint', gui.worktree, ['run', 'test:lint'], ['gui:install'], guiIn));
  steps.push(npm('gui:unit', gui.worktree, ['run', 'test:unit'], ['gui:install'], guiIn));
  if (options.e2e) steps.push(npm('gui:integration', gui.worktree, ['run', 'test:integration'], ['gui:prepublish'], guiIn));

  const host = { E2E_GUI_ROOT: gui.worktree };
  const hostNeeds = ['editor:install', 'gui:prepublish'];
  steps.push(npm('editor:install', editor.worktree, install, [], `editor:${editor.head}`));
  steps.push(npm('editor:typecheck', editor.worktree, ['run', 'typecheck'], ['editor:install'], `editor:${editor.head}`));
  steps.push(npm('editor:test', editor.worktree, ['test'], ['editor:install'], `editor:${editor.head}`));
  steps.push(npm('editor:package', editor.worktree, ['run', 'test:package'], ['editor:install'], `editor:${editor.head}`));
  steps.push(npm('editor:infrastructure', editor.worktree, ['run', 'test:e2e:infrastructure'], ['editor:install'], `editor:${editor.head}`));
  steps.push(npm('editor:extension-host', editor.worktree, ['run', 'test:extension-host'], hostNeeds, editorIn, host));
  steps.push(npm('editor:gui-integration', editor.worktree, ['run', 'test:gui-integration'],
    [...hostNeeds, ...(options.relocationUpstream ? ['gui:relocation-base'] : [])], editorIn, host));
  steps.push(npm('editor:script-transfer', editor.worktree, ['run', 'test:script-transfer'], hostNeeds, editorIn, host));
  steps.push(npm('editor:project-tools', editor.worktree, ['run', 'test:project-tools'], hostNeeds, editorIn, host));
  steps.push(npm('editor:build', editor.worktree, ['run', 'build:pages'], hostNeeds, editorIn,
    { ...host, TW_PLUS_PACKAGER_ROOT: packager, NODE_OPTIONS: '--max-old-space-size=6144' }));
  if (options.e2e) {
    steps.push(npm('editor:e2e', editor.worktree, ['run', 'test:e2e'], ['editor:build'], editorIn,
      { ...host, E2E_EXPECT_SITE_REVISION: editor.head }));
  }
  return steps;
}

/** 実マウスを動かす E2E の指定は、親プロセスから持ち込まない（plus-editor の AGENTS.md）。 */
export function stepEnv(extra: NodeJS.ProcessEnv | undefined, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base, ...extra };
  delete env.TW_PLUS_NATIVE_INPUT;
  delete env.E2E_NATIVE;
  delete env.CI;
  return env;
}

/** 各手順を1回だけ走らせる。同じ入力で前回成功したものは走らせ直さない。 */
export async function runVerification(options: SyncOptions, state: SyncState, plan: StepPlan[]): Promise<void> {
  const logs = join(state.workDir, 'logs');
  await mkdir(logs, { recursive: true });
  const previous = new Map(state.steps.map((step) => [step.name, step]));
  const results = new Map<string, StepResult>();
  for (const step of plan) {
    const before = previous.get(step.name);
    if (before?.status === 'ok' && before.inputs === step.inputs) {
      results.set(step.name, { ...before, reused: true });
      options.log(`${step.name}: 前回の成功を使います`);
      continue;
    }
    if (step.needs.some((need) => results.get(need)?.status !== 'ok')) {
      results.set(step.name, { name: step.name, status: 'skipped', inputs: step.inputs, seconds: 0, log: null });
      options.log(`${step.name}: 前提が失敗したので飛ばします`);
      continue;
    }
    const log = join(logs, `${step.name.replace(':', '-')}.log`);
    options.log(`${step.name}: ${step.command} ${step.args.join(' ')}`);
    const started = Date.now();
    const result = await options.runner(step.command, step.args, { cwd: step.cwd, env: stepEnv(step.env), logFile: log });
    const seconds = Math.round((Date.now() - started) / 1000);
    const status: StepStatus = result.code === 0 ? 'ok' : 'failed';
    const tail = status === 'failed' ? `${result.stdout}${result.stderr}`.slice(-1500) : undefined;
    results.set(step.name, { name: step.name, status, inputs: step.inputs, seconds, log, tail });
    options.log(`${step.name}: ${status === 'ok' ? '成功' : '失敗'}（${seconds}秒）`);
    state.steps = [...results.values()];
    await writeState(state);
  }
  state.steps = [...results.values()];
}

export const verified = (state: SyncState): boolean =>
  state.steps.length > 0 && state.steps.every((step) => step.status === 'ok');

// ---------------------------------------------------------------------------
// 全体

export async function newState(workDir: string, id: string): Promise<SyncState> {
  return (await readState(workDir)) ?? {
    id, createdAt: new Date().toISOString(), workDir,
    forks: { vm: null, gui: null }, packager: { pinned: undefined, latest: '' },
    guiVm: null, pins: null, editor: null, steps: [], notes: [], published: [],
  };
}

/** Packager は本家の固定 SHA を浅く取得して worktree に置く（build:pages の TW_PLUS_PACKAGER_ROOT）。 */
async function preparePackager(options: SyncOptions, workDir: string, revision: string): Promise<void> {
  const { runner } = options;
  const dir = join(workDir, 'packager');
  if (existsSync(join(dir, '.git'))) {
    if ((await git(runner, dir, 'rev-parse', 'HEAD')) === revision) return;
  } else {
    await mkdir(dir, { recursive: true });
    await git(runner, dir, 'init', '--quiet');
  }
  await git(runner, dir, 'fetch', '--no-tags', '--quiet', '--depth=1', options.targets.packager.url, revision);
  await git(runner, dir, 'checkout', '--quiet', '--detach', 'FETCH_HEAD');
}

/** 取り込み → 固定値 → 検証。push はしない。 */
export async function syncCandidate(options: SyncOptions): Promise<SyncState> {
  const workDir = join(options.workRoot, options.id);
  await mkdir(workDir, { recursive: true });
  const state = await newState(workDir, options.id);
  state.notes = [];
  const { targets, runner } = options;

  state.forks.vm = await mergeFork(options, targets.vm, workDir);
  state.forks.gui = await mergeFork(options, targets.gui, workDir);
  state.packager.latest = await lsRemote(runner, workDir, targets.packager.url, targets.packager.branch);
  const editorTarget = targets.editor;
  const editorRepo = await resolveCheckout(options, editorTarget.name, editorTarget.origin);
  const currentPins = state.pins?.before ?? await readEditorPins(runner, editorRepo, editorTarget);
  state.packager.pinned = currentPins.packagerRevision;
  await writeState(state);
  const { vm, gui } = state.forks;
  if (vm.status === 'conflict' || gui.status === 'conflict') {
    state.notes.push('衝突を解決してコミットしたあと、同じ --id で再実行してください。');
    return state;
  }

  const guiManifest = await readJson<{ dependencies: Record<string, string> }>(join(gui.worktree, 'package.json'));
  state.guiVm = parseVmDependency(guiManifest.dependencies['scratch-vm']);
  if (state.guiVm.repository !== targets.vm.repository) {
    throw new Error(`GUI の scratch-vm が ${state.guiVm.repository} を指しています（想定: ${targets.vm.repository}）`);
  }
  const vmRepo = await resolveCheckout(options, targets.vm.name, targets.vm.origin);
  await git(runner, vmRepo, 'fetch', '--no-tags', '--quiet', targets.vm.origin, state.guiVm.revision);
  if (vm.status === 'merged') {
    state.notes.push(`scratch-vm の候補 ${vm.candidate!.slice(0, 9)} は未 push のため、GUI の依存はまだ旧 VM です。` +
      'VM 単体のテストだけを走らせ、GUI と plus-editor への反映は publish で push したあとに行います。');
  } else if (!(await gitOk(runner, vmRepo, 'merge-base', '--is-ancestor', vm.upstream, state.guiVm.revision))) {
    state.notes.push(`GUI が固定する scratch-vm ${state.guiVm.revision.slice(0, 9)} は本家 develop を含みません。` +
      `フォーク develop（${vm.origin.slice(0, 9)}）を GUI に固定し直す必要があります。`);
  }

  const next: Record<PinKey, string> = {
    guiRevision: gui.candidate!,
    vmRevision: state.guiVm.revision,
    // GUI が固定する VM に含まれる、本家 develop の最新コミット。
    vmBaseRevision: await git(runner, vmRepo, 'merge-base', vm.upstream, state.guiVm.revision),
    packagerRevision: state.packager.latest,
  };
  if (gui.status === 'up-to-date' && vm.status === 'up-to-date' && PIN_KEYS.every((key) => currentPins[key] === next[key])) {
    state.notes.push('本家との差も固定値の変更もありません。追従するものはありません。');
    state.pins = { before: currentPins, after: currentPins, changes: [] };
    await writeState(state);
    return state;
  }
  const unpinned = Number(await git(runner, gui.worktree, 'rev-list', '--count', `${currentPins.guiRevision}..${gui.origin}`));
  if (unpinned > 0) {
    state.notes.push(`scratch-gui のフォーク develop には、まだ固定していない ${unpinned} コミットがあり、候補に含まれます。`);
  }

  await prepareEditor(options, state, next);
  await preparePackager(options, workDir, next.packagerRevision);
  await writeState(state);
  if (options.mergeOnly) {
    state.notes.push('--merge-only のため検証していません。');
    return state;
  }
  await verifyCandidate(options, state);
  return state;
}

export async function verifyCandidate(options: SyncOptions, state: SyncState): Promise<void> {
  const relocation = await readJson<{ upstream?: string }>(join(state.editor!.worktree, 'docs/gui-integration/relocation.json'))
    .catch(() => ({ upstream: undefined }));
  const plan = planVerification(state, {
    e2e: options.e2e, relocationUpstream: relocation.upstream ?? null, guiUpstream: options.targets.gui.upstream,
  });
  options.log(`検証: ${plan.length} 手順`);
  await runVerification(options, state, plan);
  await writeState(state);
}

async function readEditorPins(runner: Runner, repo: string, target: SyncTargets['editor']): Promise<Pins> {
  const base = await fetchRef(runner, repo, target.origin, target.branch, `${target.name}/origin`);
  return JSON.parse(await git(runner, repo, 'show', `${base}:site/source.json`)) as Pins;
}

// ---------------------------------------------------------------------------
// 報告

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 9) : '—');
const STATUS_LABEL: Record<MergeStatus, string> = { 'up-to-date': '差なし', merged: 'マージ済み（未 push）', conflict: '衝突' };
const STEP_LABEL: Record<StepStatus, string> = { ok: '成功', failed: '失敗', skipped: '未実行' };

export function formatReport(state: SyncState): string {
  const lines: string[] = [`# 本家追従の候補 ${state.id}`, ''];
  lines.push('## 取り込み', '', '| 対象 | 本家 develop | フォーク develop | 遅れ | 先行 | 本家側の変更ファイル | 状態 | 候補 |', '|---|---|---|---|---|---|---|---|');
  for (const fork of [state.forks.vm, state.forks.gui]) {
    if (!fork) continue;
    lines.push(`| ${fork.name} | ${short(fork.upstream)} | ${short(fork.origin)} | ${fork.behind} | ${fork.ahead} | ${fork.upstreamFiles} | ${STATUS_LABEL[fork.status]} | ${short(fork.candidate)} |`);
  }
  lines.push(`| packager | ${short(state.packager.latest)} | — | — | — | — | ${state.packager.latest === state.packager.pinned ? '差なし' : '更新'} | ${short(state.packager.latest)} |`, '');
  for (const fork of [state.forks.vm, state.forks.gui]) {
    if (fork?.status !== 'conflict') continue;
    lines.push(`### ${fork.name} の衝突（${fork.worktree}）`, '', ...fork.conflicts.map((file) => `- \`${file}\``), '');
  }
  if (state.pins) {
    lines.push('## 固定値（site/source.json）', '');
    if (state.pins.changes.length === 0) lines.push('変更なし', '');
    else {
      lines.push('| キー | 現在 | 候補 |', '|---|---|---|');
      for (const change of state.pins.changes) lines.push(`| \`${change.key}\` | ${short(change.from)} | ${short(change.to)} |`);
      lines.push('');
    }
  }
  if (state.steps.length > 0) {
    lines.push('## 検証', '', '| 手順 | 結果 | 秒 | ログ |', '|---|---|---|---|');
    for (const step of state.steps) {
      lines.push(`| ${step.name} | ${STEP_LABEL[step.status]}${step.reused ? '（前回の結果）' : ''} | ${step.seconds} | ${step.log ? `\`${step.log}\`` : '—'} |`);
    }
    lines.push('');
    for (const step of state.steps.filter((item) => item.status === 'failed' && item.tail)) {
      lines.push(`### ${step.name} の出力末尾`, '', '```', step.tail!.trim(), '```', '');
    }
  }
  if (state.notes.length > 0) lines.push('## 注意', '', ...state.notes.map((note) => `- ${note}`), '');
  if (state.published.length > 0) {
    lines.push('## 公開操作', '', ...state.published.map((item) => `- ${item.action}: ${item.result}`), '');
  }
  lines.push('## 次の手順', '', ...nextSteps(state).map((step, index) => `${index + 1}. ${step}`), '');
  return lines.join('\n');
}

export function nextSteps(state: SyncState): string[] {
  const { vm, gui } = state.forks;
  if (vm?.status === 'conflict' || gui?.status === 'conflict') {
    return ['衝突した worktree で解決し、`git commit` でマージを完了する。', `\`npm run upstream:sync -- --repos-dir <dir> --id ${state.id}\` で続きから再実行する。`];
  }
  if (!state.pins || state.pins.changes.length === 0 && vm?.status !== 'merged') return ['追従するものはありません。'];
  if (state.steps.length === 0) return [`\`npm run upstream:sync -- --repos-dir <dir> --id ${state.id}\` で検証まで進める。`];
  if (!verified(state)) {
    return ['失敗した手順のログを読み、該当する worktree で直してコミットする。',
      `同じ \`--id ${state.id}\` で再実行する（成功済みで入力が変わらない手順は走らせ直さない）。`];
  }
  if (state.published.length === 0) {
    return [`\`npm run upstream:sync -- --repos-dir <dir> --id ${state.id} --publish\` で、確認を取りながら push と PR 作成を行う。`];
  }
  return [
    'フォークの PR は **マージコミット**（`gh pr merge --merge`）で develop に入れる。squash や rebase では固定した SHA が develop から辿れなくなる。',
    'plus-editor の PR の CI が通ったらマージする。',
    'リリースは plus-editor の `package.json` の version を上げて `v<version>` タグを push する（Release workflow が `release-verification.ts` で検証済みのリビジョンだけを公開する）。',
  ];
}

/** 候補の識別に使う短いハッシュ。報告の照合用。 */
export function candidateDigest(state: SyncState): string {
  const parts = [state.forks.vm?.candidate, state.forks.gui?.candidate, state.packager.latest, state.editor?.head];
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// push と PR（確認付き）

export type Confirm = (question: string) => Promise<boolean>;

class Declined extends Error {}

/**
 * 検証済みの候補を push して PR を作る。1件ずつ確認を取り、断られたらそこで止める。
 * scratch-vm を取り込んだときは、push した VM を GUI の依存に固定し直し、検証をやり直してから先へ進む。
 */
export async function publishCandidate(options: SyncOptions, state: SyncState, confirm: Confirm): Promise<void> {
  if (!verified(state)) throw new Error('検証が全件成功していない候補は push しません。');
  const { runner, targets } = options;
  const done = (action: string) => state.published.some((item) => item.action === action);
  const step = async (action: string, question: string, run: () => Promise<string>) => {
    if (done(action)) return;
    if (!(await confirm(question))) throw new Declined(`${action} を見送りました。`);
    state.published.push({ action, result: await run() });
    await writeState(state);
  };
  const push = (cwd: string, url: string, branch: string) => async () => {
    await git(runner, cwd, 'push', url, `HEAD:refs/heads/${branch}`);
    return `${branch} を push しました`;
  };
  const pr = (repository: string, base: string, branch: string, title: string, body: string) => async () => {
    const file = join(state.workDir, `pr-${repository.replace('/', '-')}.md`);
    await writeFile(file, body);
    const result = await runner('gh', ['pr', 'create', '-R', repository, '--base', base, '--head', branch,
      '--title', title, '--body-file', file], { cwd: state.workDir });
    if (result.code !== 0) throw new Error(`gh pr create が失敗しました (${repository}):\n${result.stderr.trim()}`);
    return result.stdout.trim().split('\n').pop() ?? '';
  };
  const forkBody = (fork: ForkResult, target: ForkTarget) =>
    `本家 ${target.upstreamRepository} の ${target.branch}（${fork.upstream}）を取り込みます。\n\n` +
    `- 取り込む本家コミット: ${fork.behind}\n- 本家側の変更ファイル: ${fork.upstreamFiles}\n\n` +
    '固定 SHA を develop から辿れるように、**マージコミット**で入れてください。\n';

  try {
    const { vm } = state.forks;
    let gui = state.forks.gui!;
    if (vm?.status === 'merged' && vm.branch && vm.candidate) {
      await step('push:scratch-vm', `scratch-vm の ${vm.branch}（${short(vm.candidate)}）を ${targets.vm.pushUrl} へ push しますか？`,
        push(vm.worktree, targets.vm.pushUrl, vm.branch));
      await step('pr:scratch-vm', `${targets.vm.repository} に PR を作りますか？`,
        pr(targets.vm.repository, targets.vm.branch, vm.branch, `chore(upstream): 本家 ${targets.vm.upstreamRepository} の ${targets.vm.branch} を取り込む`, forkBody(vm, targets.vm)));
      if (state.guiVm?.revision !== vm.candidate) {
        options.log('scratch-gui: push した scratch-vm を依存に固定し直します');
        if (!gui.branch) {
          gui.branch = forkBranch(options.id);
          await git(runner, gui.worktree, 'switch', '--quiet', '-c', gui.branch);
        }
        const manifestFile = join(gui.worktree, 'package.json');
        const manifest = await readJson<{ dependencies: Record<string, string> }>(manifestFile);
        const source = await readFile(manifestFile, 'utf8');
        const spec = vmDependency(targets.vm.repository, vm.candidate);
        await writeFile(manifestFile, source.replace(manifest.dependencies['scratch-vm'], spec));
        const install = await runner('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: gui.worktree });
        if (install.code !== 0) throw new Error(`scratch-gui の lock を更新できません:\n${install.stderr.trim()}`);
        const lock = await readJson<{ packages: Record<string, { resolved?: string }> }>(join(gui.worktree, 'package-lock.json'));
        const resolved = lock.packages['node_modules/scratch-vm']?.resolved ?? '';
        if (!resolved.endsWith(`#${vm.candidate}`)) throw new Error(`scratch-gui の lock が新しい VM を指していません: ${resolved}`);
        await git(runner, gui.worktree, 'add', 'package.json', 'package-lock.json');
        await git(runner, gui.worktree, 'commit', '--quiet', '-m', 'chore(deps): 本家を取り込んだ Scratch VM を固定する');
        gui = { ...gui, candidate: await git(runner, gui.worktree, 'rev-parse', 'HEAD') };
        state.forks.gui = gui;
        state.guiVm = { repository: targets.vm.repository, revision: vm.candidate };
        await prepareEditor(options, state, {
          guiRevision: gui.candidate!, vmRevision: vm.candidate, vmBaseRevision: vm.upstream,
          packagerRevision: state.pins!.after.packagerRevision!,
        });
        await writeState(state);
        await verifyCandidate(options, state);
        if (!verified(state)) throw new Error('新しい VM を固定した候補の検証が失敗しました。報告を確認してください。');
      }
    }
    if (gui.branch && gui.candidate) {
      await step('push:scratch-gui', `scratch-gui の ${gui.branch}（${short(gui.candidate)}）を ${targets.gui.pushUrl} へ push しますか？`,
        push(gui.worktree, targets.gui.pushUrl, gui.branch));
      await step('pr:scratch-gui', `${targets.gui.repository} に PR を作りますか？`,
        pr(targets.gui.repository, targets.gui.branch, gui.branch, `chore(upstream): 本家 ${targets.gui.upstreamRepository} の ${targets.gui.branch} を取り込む`, forkBody(gui, targets.gui)));
    }
    const editor = state.editor!;
    await step('push:turbowarp-plus-editor', `plus-editor の ${editor.branch}（${short(editor.head)}）を push しますか？`,
      push(editor.worktree, targets.editor.pushUrl, editor.branch));
    await step('pr:turbowarp-plus-editor', `${targets.editor.repository} に PR を作りますか？`,
      pr(targets.editor.repository, targets.editor.branch, editor.branch, `chore(deps): 本家追従の候補 ${state.id} を固定する`,
        `${formatReport(state)}\nフォークの PR を先にマージコミットで入れてから、この PR をマージしてください。\n`));
  } catch (error) {
    if (!(error instanceof Declined)) throw error;
    state.notes.push(error.message);
    await writeState(state);
  }
}
