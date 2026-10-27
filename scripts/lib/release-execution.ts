import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import semver from 'semver';
import type { PackagePlan, ReleasePlan } from './release-plan.ts';

export type Command = string[];
export interface ReleaseProfile {
  install: Command[];
  prepare?: Command[];
  verify: Command[];
  artifacts?: string[];
  publish: { mode: 'cli'; provenance: boolean } |
    { mode: 'tag-workflow' | 'dispatch-workflow'; workflow: string; inputs?: Record<string, string> };
  npm?: Command;
}
export interface ExecutionConfig {
  schemaVersion: 1;
  repositories: Record<string, ReleaseProfile>;
  reviewedRepositories?: string[];
  workflowTimeoutSeconds?: number;
  trustedPublisherOnly?: boolean;
  contracts?: { repository: string; sha: string; files: Record<string, string> }[];
}
export const PHASES = ['pending', 'prepared', 'pushed', 'merged', 'tagged', 'released', 'published', 'complete'] as const;
export type Phase = typeof PHASES[number];
export interface ExecutionEntry {
  phase: Phase;
  base?: string;
  branch?: string;
  commit?: string;
  mergeCommit?: string;
  pr?: number;
  prUrl?: string;
  artifact?: string;
  shasum?: string;
  releaseUrl?: string;
  workflowRun?: number;
  dispatchStartedAt?: string;
  publishStartedAt?: string;
  publishAccepted?: boolean;
  extraArtifacts?: { path: string; sha256: string }[];
  dispatchHeadSha?: string;
  error?: string;
}
export interface ExecutionState {
  schemaVersion: 1;
  digest: string;
  entries: Record<string, ExecutionEntry>;
  effectiveConfig?: ExecutionConfig;
}
export interface ReleaseDriver {
  preflight(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void>;
  prepared(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void>;
  pushed(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void>;
  merged(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void>;
  tagged(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void>;
  released(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void>;
  published(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void>;
  complete(step: PackagePlan, profile: ReleaseProfile, entry: ExecutionEntry): Promise<void>;
}

const repositoryPattern = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/u;
const shaPattern = /^[a-f0-9]{40}$/u;
const validCommand = (value: unknown): value is Command => Array.isArray(value) && value.length > 0 &&
  value.every(part => typeof part === 'string' && !part.includes('\0')) && Boolean(value[0]);
const relativeFile = (file: string) => file.length > 0 && !file.startsWith('/') && !file.includes('\\') &&
  file.split('/').every(part => part !== '..' && part !== '' && part !== '.git');

/** Validate the entire approved input before any target is changed. */
export function validateExecution(plan: ReleasePlan, config: ExecutionConfig): void {
  if (plan.schemaVersion !== 1 || plan.mode !== 'plan' || plan.ready !== true || !Array.isArray(plan.steps) ||
      !Array.isArray(plan.order) || config.schemaVersion !== 1 || !config.repositories ||
      !plan.snapshot || !/^[a-f0-9]{64}$/u.test(plan.snapshot.sha256) || !Number.isFinite(Date.parse(plan.snapshot.generatedAt)) ||
      !plan.steps.length || new Set(plan.order).size !== plan.order.length ||
      JSON.stringify(plan.order) !== JSON.stringify(plan.steps.map(step => step.repo))) {
    throw new Error('不正または未解決のリリース計画です。');
  }
  if (config.workflowTimeoutSeconds !== undefined && (!Number.isInteger(config.workflowTimeoutSeconds) ||
      config.workflowTimeoutSeconds < 1 || config.workflowTimeoutSeconds > 86400)) throw new Error('workflow timeoutが不正です。');
  for (const [index, step] of plan.steps.entries()) {
    if (!repositoryPattern.test(step.repository) || step.repository.split('/')[1] !== step.repo ||
        ['.', '..'].includes(step.repo) || !step.headSha || !shaPattern.test(step.headSha) ||
        !['none', 'publish', 'update-only'].includes(step.action) || !semver.valid(step.currentVersion) ||
        !step.name || !/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/u.test(step.name) ||
        (step.action !== 'none' && !semver.valid(step.nextVersion)) ||
        step.issues.some(issue => issue.severity === 'blocker')) throw new Error(`${step.repo}: 計画が不正です。`);
    if (step.issues.some(issue => issue.requiresReview) && !config.reviewedRepositories?.includes(step.repository)) {
      throw new Error(`${step.repo}: peer/Git/RC等の変更案について reviewedRepositories で明示レビューが必要です。`);
    }
    const changes = new Set<string>();
    for (const update of step.dependencyUpdates) {
      const key = `${update.field}:${update.name}`;
      if (changes.has(key) || !['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].includes(update.field) ||
          !update.to || !semver.valid(update.targetVersion)) throw new Error(`${step.repo}: 依存更新が不正です。`);
      changes.add(key);
      if (update.source === 'planned') {
        const upstream = plan.steps.findIndex(item => item.repo === update.upstreamRepo);
        if (upstream < 0 || upstream >= index || plan.steps[upstream].action !== 'publish' ||
            plan.steps[upstream].nextVersion !== update.targetVersion || plan.steps[upstream].name !== update.name) {
          throw new Error(`${step.repo}: 依存先が先行するDFS順ではありません。`);
        }
      }
    }
    const profile = config.repositories[step.repository];
    if (!profile || !Array.isArray(profile.install) || !profile.install.length ||
        !Array.isArray(profile.verify) || !profile.verify.length ||
        ![...profile.install, ...(profile.prepare ?? []), ...profile.verify].every(validCommand) ||
        (profile.npm && !validCommand(profile.npm)) ||
        (profile.artifacts && !profile.artifacts.every(file => typeof file === 'string' && relativeFile(file))) ||
        !profile.publish || !['cli', 'tag-workflow', 'dispatch-workflow'].includes(profile.publish.mode)) {
      throw new Error(`${step.repo}: install/verify/publishを含む実行設定が必要です。`);
    }
    if (profile.publish.mode === 'cli') {
      if (config.trustedPublisherOnly) throw new Error(`${step.repo}: Trusted Publisher方式が必要です。`);
      if (typeof profile.publish.provenance !== 'boolean') throw new Error(`${step.repo}: provenance方針を明示してください。`);
    } else if (!/^[a-zA-Z0-9_.-]+\.ya?ml$/u.test(profile.publish.workflow) ||
        (profile.publish.inputs && Object.values(profile.publish.inputs).some(value => typeof value !== 'string'))) {
      throw new Error(`${step.repo}: workflow設定が不正です。`);
    }
    if (config.trustedPublisherOnly && profile.publish.mode !== 'cli' && profile.publish.workflow !== 'release.yml') {
      throw new Error(`${step.repo}: workflowはrelease.ymlが必要です。`);
    }
  }
  const targets = plan.steps.flatMap(step => step.action === 'publish' ? [{
    repository: step.repository, name: step.name, version: step.nextVersion, tag: `v${step.nextVersion}`, headSha: step.headSha,
  }] : []);
  if (!Array.isArray(plan.publishTargets) || targets.length !== plan.publishTargets.length || targets.some((target, index) =>
    Object.entries(target).some(([key, value]) => plan.publishTargets[index][key as keyof typeof target] !== value))) {
    throw new Error('公開対象がstepsと一致しません。');
  }
}

export function executionDigest(plan: ReleasePlan, config: ExecutionConfig): string {
  validateExecution(plan, config);
  return createHash('sha256').update(JSON.stringify({ plan, config })).digest('hex');
}

export async function saveExecutionState(directory: string, state: ExecutionState): Promise<void> {
  const temporary = join(directory, `.state-${randomUUID()}.json`);
  try {
    await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, join(directory, 'state.json'));
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Persist every boundary; re-check completed upstreams before continuing a resumed batch. */
export async function executeReleasePlan(
  plan: ReleasePlan, config: ExecutionConfig, workspace: string,
  createDriver: (save: () => Promise<void>, state: ExecutionState) => ReleaseDriver,
  confirmation: string,
  progress: (repository: string, phase: string) => void = () => {},
): Promise<ExecutionState> {
  const digest = executionDigest(plan, config);
  if (confirmation !== digest) throw new Error('dry-runで表示した実行digestと確認値が一致しません。');
  const directory = resolve(workspace);
  await mkdir(directory, { recursive: true });
  const lock = join(directory, '.execution-lock');
  await mkdir(lock).catch(() => { throw new Error('同じworkspaceの実行が進行中です。停止状態を確認するまでlockを削除しないでください。'); });
  try {
    let state: ExecutionState;
    try {
      state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')) as ExecutionState;
      if (state.schemaVersion !== 1 || state.digest !== digest || !state.entries ||
          Object.keys(state.entries).some(repo => !plan.order.includes(repo)) ||
          Object.values(state.entries).some(entry => !PHASES.includes(entry.phase))) {
        throw new Error('再開記録とplan/configが一致しません。');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      state = { schemaVersion: 1, digest, entries: Object.create(null) as Record<string, ExecutionEntry>, effectiveConfig: config };
    }
    const save = () => saveExecutionState(directory, state);
    const driver = createDriver(save, state);
    for (const step of plan.steps) {
      const entry = Object.hasOwn(state.entries, step.repo) ? state.entries[step.repo] : { phase: 'pending' as const };
      Object.defineProperty(state.entries, step.repo, { value: entry, enumerable: true, writable: true, configurable: true });
      progress(step.repository, 'preflight');
      try {
        await driver.preflight(step, config.repositories[step.repository], entry);
        delete entry.error;
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
        await save();
        throw error;
      }
    }
    await save();
    for (const step of plan.steps) {
      const entry = state.entries[step.repo];
      const profile = config.repositories[step.repository];
      try {
        if (entry.phase === 'complete') {
          progress(step.repository, 'recheck');
          await driver.complete(step, profile, entry);
          delete entry.error;
          await save();
        }
        else for (const phase of PHASES.slice(PHASES.indexOf(entry.phase) + 1)) {
          if (phase === 'pending') continue;
          progress(step.repository, phase);
          await driver[phase](step, profile, entry);
          entry.phase = phase;
          delete entry.error;
          await save();
        }
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
        await save();
        throw error;
      }
    }
    return state;
  } finally {
    await rm(lock, { recursive: true });
  }
}
