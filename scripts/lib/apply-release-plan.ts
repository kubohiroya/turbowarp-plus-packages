import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ReleasePlan } from './release-plan.ts';

interface Edit {
  path: string;
  before: string;
  after: string;
  mode: number;
}

const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
}).trim();

async function replace(edit: Edit, content: string): Promise<void> {
  const temporary = `${edit.path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: edit.mode });
    await rename(temporary, edit.path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Preflight every selected checkout before changing manifests, without running lifecycle scripts. */
export async function applyReleasePlan(plan: ReleasePlan, reposDir: string): Promise<string[]> {
  if (plan.direction !== 'downstream') throw new Error('依存元への計画だけを適用できます。');
  if (!plan.ready || plan.steps.some((step) => step.action === 'blocked')) {
    throw new Error('未解決事項があるため、ファイルは変更しません。');
  }
  if (!plan.applyReady || plan.steps.some(step => step.issues.some(issue => issue.requiresReview))) {
    throw new Error('レビューが必要な変更案があるため、ローカル自動適用は行いません。');
  }
  const parent = await realpath(reposDir);
  const edits: Edit[] = [];
  for (const step of plan.steps) {
    if (basename(step.repo) !== step.repo || step.repo === '.' || step.repo === '..') {
      throw new Error(`不正なrepo名です: ${step.repo}`);
    }
    const repo = await realpath(join(parent, step.repo));
    if (dirname(repo) !== parent || await realpath(git(repo, 'rev-parse', '--show-toplevel')) !== repo) {
      throw new Error(`独立したcheckoutではありません: ${repo}`);
    }
    if (git(repo, 'rev-parse', 'HEAD') !== step.headSha) {
      throw new Error(`${step.repo}: HEADが解析時のSHAと異なります。解析JSONを更新してください。`);
    }
    if (git(repo, 'status', '--porcelain', '--untracked-files=normal')) {
      throw new Error(`${step.repo}: 未コミット変更または未追跡ファイルがあります。`);
    }
    const path = join(repo, 'package.json');
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`通常ファイルではありません: ${path}`);
    const before = await readFile(path, 'utf8');
    const manifest = JSON.parse(before);
    if (manifest.name !== step.name || (manifest.version ?? null) !== step.currentVersion) {
      throw new Error(`${step.repo}: package.jsonのname/versionが解析結果と異なります。`);
    }
    let changed = false;
    for (const update of step.dependencyUpdates) {
      if (!update.to || manifest[update.field]?.[update.name] !== update.from) {
        throw new Error(`${step.repo}: ${update.field}.${update.name}が解析結果と異なるか、変更先が未確定です。`);
      }
      manifest[update.field][update.name] = update.to;
      changed = true;
    }
    if (step.nextVersion && step.nextVersion !== step.currentVersion) {
      manifest.version = step.nextVersion;
      changed = true;
    }
    if (changed) {
      const indent = /\n([\t ]+)\S/.exec(before)?.[1] ?? 2;
      const newline = before.includes('\r\n') ? '\r\n' : '\n';
      const after = JSON.stringify(manifest, null, indent).replace(/\n/g, newline) +
        (before.endsWith('\n') ? newline : '');
      edits.push({ path, before, after, mode: stat.mode & 0o777 });
    }
  }
  const applied: Edit[] = [];
  try {
    for (const edit of edits) {
      if (await readFile(edit.path, 'utf8') !== edit.before) throw new Error(`適用直前に変更されました: ${edit.path}`);
      await replace(edit, edit.after);
      applied.push(edit);
    }
  } catch (error) {
    const failures: string[] = [];
    for (const edit of applied.reverse()) {
      try {
        if (await readFile(edit.path, 'utf8') !== edit.after) throw new Error('concurrent modification');
        await replace(edit, edit.before);
      } catch {
        failures.push(edit.path);
      }
    }
    if (failures.length) throw new Error(`適用に失敗し、自動復元できないファイルがあります: ${failures.join(', ')}`, { cause: error });
    throw error;
  }
  return edits.map((edit) => edit.path);
}
