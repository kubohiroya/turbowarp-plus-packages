import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ExecutionConfig, ExecutionState } from './release-execution.ts';
import { executionDigest } from './release-execution.ts';
import type { ReleasePlan } from './release-plan.ts';
import { runCommand } from './release-driver.ts';
import { hash, readJson, writeJson } from './release-io.ts';

export interface Candidate {
  repo: string; repository: string; inputSha: string; base: string; branch: string;
  commit: string; tree: string; diff: string; publication: NonNullable<ExecutionState['entries'][string]['publication']>;
  artifacts: NonNullable<ExecutionState['entries'][string]['extraArtifacts']>;
}
export interface Bundle {
  schemaVersion: 1; mode: 'candidates'; workspace: string; planDigest: string;
  candidates: Candidate[]; digest: string;
}
export async function createBundle(plan: ReleasePlan, config: ExecutionConfig, workspace: string, state: ExecutionState) {
  const candidates: Candidate[] = [];
  for (const step of plan.steps) {
    const entry = state.entries[step.repo];
    if (step.action === 'none' || entry.cancelled || entry.phase !== 'prepared') continue;
    assert(entry.commit && entry.base && entry.branch && entry.publication, '検証済み候補の記録が不足しています。');
    const cwd = join(workspace, 'checkouts', step.repo);
    assert.equal(await runCommand(['git', 'status', '--porcelain'], { cwd }), '');
    assert.equal(await runCommand(['git', 'rev-parse', 'HEAD'], { cwd }), entry.commit);
    candidates.push({ repo: step.repo, repository: step.repository, inputSha: step.headSha!, base: entry.base, branch: entry.branch,
      commit: entry.commit, tree: await runCommand(['git', 'rev-parse', `${entry.commit}^{tree}`], { cwd }),
      diff: await runCommand(['git', 'diff', '--binary', step.headSha!, entry.commit], { cwd }), publication: entry.publication,
      artifacts: entry.extraArtifacts ?? [] });
  }
  const payload = { schemaVersion: 1 as const, mode: 'candidates' as const, workspace: resolve(workspace),
    planDigest: executionDigest(plan, config), candidates };
  const bundle = { ...payload, digest: hash(payload) };
  await writeJson(join(workspace, 'candidates.json'), bundle);
  return bundle;
}
export async function verifyBundle(plan: ReleasePlan, config: ExecutionConfig, workspace: string, file: string, confirmation: string) {
  const bundle: Bundle = await readJson(file);
  const { digest, ...payload } = bundle;
  assert(digest === confirmation && digest === hash(payload), '候補の確認digestが一致しません。');
  assert(bundle.schemaVersion === 1 && bundle.mode === 'candidates' && bundle.workspace === resolve(workspace) &&
    bundle.planDigest === executionDigest(plan, config) && bundle.candidates.length, '候補と実行計画が一致しません。');
  const state: ExecutionState = await readJson(join(workspace, 'state.json'));
  assert.equal(state.digest, bundle.planDigest);
  assert(new Set(bundle.candidates.map(c => c.repo)).size === bundle.candidates.length);
  for (const c of bundle.candidates) {
    const step = plan.steps.find(s => s.repo === c.repo);
    const entry = state.entries[c.repo];
    assert(step && step.repository === c.repository && step.headSha === c.inputSha && entry && entry.phase !== 'pending');
    assert.equal(entry.commit, c.commit);
    assert.equal(entry.base, c.base);
    assert.equal(entry.branch, c.branch);
    assert.deepEqual(entry.publication, c.publication, '公開文面が承認後に変わりました。');
    assert.deepEqual(entry.extraArtifacts ?? [], c.artifacts);
    for (const asset of c.artifacts) assert.equal(createHash('sha256').update(await readFile(asset.path)).digest('hex'), asset.sha256);
    const cwd = join(workspace, 'checkouts', c.repo);
    assert.equal(await runCommand(['git', 'rev-parse', `${c.commit}^{tree}`], { cwd }), c.tree);
    assert.equal(await runCommand(['git', 'diff', '--binary', c.inputSha, c.commit], { cwd }), c.diff);
    assert.equal(await runCommand(['git', 'status', '--porcelain'], { cwd }), '');
  }
  return bundle;
}
