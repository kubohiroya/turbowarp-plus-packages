import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import type { ExecutionConfig, ReleaseProfile } from './release-execution.ts';
import type { ReleasePlan } from './release-plan.ts';

export interface ContractSource { repository: string; sha: string; files: Record<string, string> }
export interface ResolvedConfig extends ExecutionConfig {
  trustedPublisherOnly: true;
  contracts: ContractSource[];
}
type ReadSource = (repository: string, sha: string, file: string) => string;
export interface ContractOverrides {
  repositories: Record<string, Partial<ReleaseProfile>>;
  reviewedRepositories?: string[];
  workflowTimeoutSeconds?: number;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
/** Prove event exclusion only for a small conjunction grammar, never by substring matching. */
function constrainedEvents(condition: unknown): Set<string> | undefined {
  if (condition === false) return new Set();
  if (typeof condition !== 'string') return undefined;
  let expression = condition.trim();
  if (expression.startsWith('${{') && expression.endsWith('}}')) expression = expression.slice(3, -2).trim();
  let events: Set<string> | undefined;
  for (const clause of expression.split('&&')) {
    const match = /^github\.(event_name|ref)\s*==\s*(['"])([A-Za-z0-9_./:-]+)\2$/u.exec(clause.trim());
    if (!match) return undefined;
    if (match[1] === 'event_name') {
      events = events === undefined ? new Set([match[3]]) : new Set([...events].filter(event => event === match[3]));
    }
  }
  return events;
}
const object = (value: unknown): Record<string, any> => {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'リリース契約にobjectが必要です。');
  return value as Record<string, any>;
};

/** Read immutable Git objects; do not fetch, checkout, or use dirty working files. */
export function localContractReader(directory: string): ReadSource {
  return (repository, sha, file) => {
    const name = repository.split('/')[1];
    assert(/^[A-Za-z0-9_.-]+$/u.test(name) && !['.', '..'].includes(name));
    assert(/^[a-f0-9]{40}$/u.test(sha));
    const cwd = join(resolve(directory), name);
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      throw new Error(`入力SHA ${sha}をローカルで読めません。GitHub側の不足とは判定しません。fetchまたは再計画が必要です。`);
    }
    try {
      return execFileSync('git', ['show', `${sha}:${file}`], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
      });
    } catch {
      throw new Error(`入力SHA ${sha}に${file}がありません。GitHub最新版の状態は未判定です。最新データから再計画してください。`);
    }
  };
}

/** Infer existing scripts and generic OIDC jobs; extra repository declarations are optional. */
export function profileFromContract(manifestText: string, workflowText: string, exception: Partial<ReleaseProfile> = {}): ReleaseProfile {
  const manifest = object(JSON.parse(manifestText));
  const contract = manifest.turbowarpRelease === undefined ? {} : object(manifest.turbowarpRelease);
  if (manifest.turbowarpRelease !== undefined) assert.equal(contract.schemaVersion, 1, 'turbowarpRelease.schemaVersionは1が必要です。');
  const scripts = manifest.scripts ?? {};
  const has = (name: string) => typeof scripts[name] === 'string' && scripts[name].trim();
  const manager = /^(npm|pnpm)@(\d+\.\d+\.\d+)(?:\+.*)?$/u.exec(manifest.packageManager ?? '');
  // Existing npm workflows do not need a new packageManager declaration.
  assert(manager || /\bnpm ci\b/u.test(workflowText) || exception.install?.length, '既存のinstall手順を特定できません。install例外を指定してください。');
  const command = manager?.[1] === 'pnpm' ? ['corepack', 'pnpm'] : ['npx', '--yes', `npm@${manager?.[2] ?? '11.21.0'}`];
  const prepareName = ['release:prepare', 'prepare:release'].find(has);
  const verifyName = ['release:verify', 'verify:release', 'verify:full', 'check', 'verify'].find(has);
  const verify = verifyName ? [command.concat('run', verifyName)] : ['typecheck', 'lint', 'test', 'build'].filter(has).map(name => command.concat('run', name));
  assert(verify.length || exception.verify?.length, '既存の検証手順を特定できません。verify例外を指定してください。');
  const commands = {
    install: manager?.[1] === 'pnpm'
      ? [command.concat('install', '--lockfile-only'), command.concat('install', '--frozen-lockfile')]
      : [command.concat('install', '--package-lock-only'), command.concat('ci')],
    prepare: prepareName ? [command.concat('run', prepareName)] : ['docs', 'build'].filter(has).map(name => command.concat('run', name)),
    verify, artifacts: contract.artifacts ?? [],
  };
  if (exception.publish) assert(exception.publish.mode !== 'cli' && exception.publish.workflow === 'release.yml', '例外もTrusted Publisher・release.ymlが必須です。');
  if (manifest.private === true) return { ...commands, ...exception, publish: { mode: 'tag-workflow', workflow: 'release.yml' } };
  const doc = parseDocument(workflowText, { uniqueKeys: true });
  assert(!doc.errors.length, `release.ymlが不正です: ${doc.errors.map(error => error.message).join(', ')}`);
  const workflow = object(doc.toJS());
  const events = object(workflow.on);
  const hint = exception.publish ?? contract.publish;
  if (hint) {
    assert.equal(hint.workflow, 'release.yml', 'workflowはrelease.ymlに統一します。');
    assert(['tag-workflow', 'dispatch-workflow'].includes(hint.mode), '公開はTrusted Publisher方式のみです。');
  }
  const jobs = Object.entries(object(workflow.jobs));
  const candidates: { job: string; mode: 'tag-workflow' | 'dispatch-workflow' }[] = [];
  const publishingJobs: { name: string; condition: unknown }[] = [];
  const problems: string[] = [];
  for (const [name, raw] of jobs) {
    const job = object(raw);
    if (!Array.isArray(job.steps) || !job.steps.some((step: any) => typeof step.run === 'string' && /(?:^|\n)\s*(?:npm|pnpm) publish(?:\s|$)/u.test(step.run))) continue;
    publishingJobs.push({ name, condition: job.if });
    if (contract.publish?.job && contract.publish.job !== name) continue;
    const run = job.steps.filter((step: any) => typeof step.run === 'string').map((step: any) => step.run).join('\n');
    const condition = String(job.if ?? '');
    if (/\d+\.\d+\.\d+/u.test(condition) || /(?:npm|pnpm) publish[^\n]*(?:\d+\.\d+\.\d+|--dry-run)/u.test(run) || /gh release download\s+['"]?v\d+\.\d+\.\d+/u.test(run)) {
      problems.push(`${name}: 固定版・dry-run専用の公開job`); continue;
    }
    if ((job.permissions ?? workflow.permissions)?.['id-token'] !== 'write') { problems.push(`${name}: id-token: writeがない`); continue; }
    if (/(?:NODE_AUTH_TOKEN|NPM_TOKEN)/u.test(JSON.stringify([workflow.env, job]))) { problems.push(`${name}: 長期npm tokenを使用`); continue; }
    const eventConstraint = constrainedEvents(job.if);
    const tag = Array.isArray(events.push?.tags) && events.push.tags.includes('v*') &&
      (!eventConstraint || eventConstraint.has('push')) && !condition.includes('refs/heads/');
    const dispatch = Object.hasOwn(events, 'workflow_dispatch') &&
      (!eventConstraint || eventConstraint.has('workflow_dispatch')) && !condition.includes('refs/tags/');
    if (hint?.mode === 'tag-workflow' ? tag : !hint && tag) candidates.push({ job: name, mode: 'tag-workflow' });
    else if (dispatch && (!hint || hint.mode === 'dispatch-workflow')) candidates.push({ job: name, mode: 'dispatch-workflow' });
  }
  assert(candidates.length === 1, `汎用OIDC公開jobを一意に特定できません。${problems.join(' / ')}`);
  const selected = candidates[0];
  const selectedEvent = selected.mode === 'tag-workflow' ? 'push' : 'workflow_dispatch';
  for (const job of publishingJobs) {
    if (job.name === selected.job) continue;
    const eventConstraint = constrainedEvents(job.condition);
    assert(eventConstraint && !eventConstraint.has(selectedEvent),
      `${job.name}: 他の公開jobが${selectedEvent}で停止すると証明できません。workflow全体の公開を許可しません。`);
  }
  let inputs: Record<string, string> | undefined = hint?.inputs;
  if (selected.mode === 'dispatch-workflow') {
    const declared = events.workflow_dispatch?.inputs ?? {};
    if (inputs === undefined) {
      inputs = {};
      for (const [name, placeholder] of Object.entries({ version: '{version}', tag: '{tag}', shasum: '{shasum}' })) {
        if (Object.hasOwn(declared, name)) inputs[name] = placeholder;
      }
    }
    assert(Object.values(object(inputs)).every(value => typeof value === 'string'), 'workflow inputsが不正です。');
    assert(Object.keys(inputs).every(key => Object.hasOwn(declared, key)), '未定義のworkflow inputがあります。');
    assert(Object.entries(declared).every(([key, value]: [string, any]) => !value.required || value.default !== undefined || Object.hasOwn(inputs!, key)), '必須workflow inputを推定できません。publish.inputs例外を指定してください。');
  }
  return { ...commands, ...exception, publish: { mode: selected.mode, workflow: 'release.yml', ...(inputs ? { inputs } : {}) } };
}

/** Exception precedence: explicit fields replace standard fields; publishing cannot be downgraded. */
export function resolveContracts(plan: ReleasePlan, read: ReadSource, overrides?: ContractOverrides): ResolvedConfig {
  const result: ResolvedConfig = {
    schemaVersion: 1, trustedPublisherOnly: true, contracts: [], repositories: {},
    reviewedRepositories: overrides?.reviewedRepositories ?? [], workflowTimeoutSeconds: overrides?.workflowTimeoutSeconds ?? 3600,
  };
  const errors: string[] = [];
  for (const step of plan.steps) {
    try {
      const manifest = read(step.repository, step.headSha!, 'package.json');
      const metadata = JSON.parse(manifest);
      const workflow = metadata.private === true ? '' : read(step.repository, step.headSha!, '.github/workflows/release.yml');
      const override = overrides?.repositories[step.repository];
      const profile = profileFromContract(manifest, workflow, override);
      assert.equal(metadata.name, step.name, '計画とpackage名が異なります。');
      assert.equal(metadata.version, step.currentVersion, '計画とpackage版が異なります。');
      result.repositories[step.repository] = profile;
      result.contracts.push({ repository: step.repository, sha: step.headSha!, files: {
        'package.json': hash(manifest), ...(workflow ? { '.github/workflows/release.yml': hash(workflow) } : {}),
      } });
    } catch (error) { errors.push(`${step.repo}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  assert(!errors.length, `リリース手順を確定できません。公開は開始しません。\n${errors.join('\n')}`);
  return result;
}

/** Apply this policy to explicit configs too; legacy CLI configs require migration. */
export function trustedConfig(config: ExecutionConfig): ExecutionConfig {
  for (const [repository, profile] of Object.entries(config.repositories)) {
    assert(profile.publish.mode !== 'cli' && profile.publish.workflow === 'release.yml', `${repository}: Trusted Publisher・release.ymlへの移行が必要です。`);
  }
  return { ...config, trustedPublisherOnly: true };
}
