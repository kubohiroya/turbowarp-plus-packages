import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readJson, writeJson, lockRepositories, defaultLockDir, hash } from './release-io.ts';
import { runCommand } from './release-driver.ts';
import type { Runner } from './release-driver.ts';
import type { ReleasePlan } from './release-plan.ts';
import type { ExecutionConfig, ExecutionState } from './release-execution.ts';
import { executionDigest } from './release-execution.ts';

const repository = 'kubohiroya/turbowarp-plus-packages';
const page = 'https://kubohiroya.github.io/turbowarp-plus-packages/';
export async function finish(plan: ReleasePlan, config: ExecutionConfig, workspace: string, confirmation: string,
  run: Runner = runCommand, get: typeof fetch = fetch) {
  const digest = executionDigest(plan, config);
  assert.equal(confirmation, digest, 'Pagesの確認digestが異なります。');
  const unlock = await lockRepositories(defaultLockDir, [repository, ...plan.steps.map(s => s.repository)], workspace);
  try {
    const state: ExecutionState = await readJson(join(workspace, 'state.json'));
    assert.equal(state.digest, digest);
    assert(plan.steps.every(s => !state.entries[s.repo]?.error &&
      (state.entries[s.repo]?.phase === 'complete' || state.entries[s.repo]?.cancelled)), '未完了の対象があります。');
    const path = join(workspace, 'dashboard.json');
    let record: { digest: string; startedAt: string; run?: number; complete?: boolean };
    try { record = await readJson(path); assert.equal(record.digest, digest); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      record = { digest, startedAt: new Date().toISOString() };
      await writeJson(path, record);
      // Intent is durable before dispatch: uncertain dispatches are inspected, never sent twice.
      await run(['gh', 'workflow', 'run', 'pages.yml', '--repo', repository, '--ref', 'main', '-f', `release_id=${digest}`]);
    }
    if (!record.run) {
      const response = JSON.parse(await run(['gh', 'api', '--method', 'GET',
        `repos/${repository}/actions/workflows/pages.yml/runs?event=workflow_dispatch&per_page=100`]));
      const runs = response.workflow_runs.filter((r: any) => r.display_title === `Dashboard ${digest}` && Date.parse(r.created_at) >= Math.floor(Date.parse(record.startedAt)/1000)*1000 && r.head_branch === 'main');
      assert.equal(runs.length, 1, 'Pages runを一意に特定できません。再dispatchせず記録を確認してください。');
      record.run = runs[0].id;
      await writeJson(path, record);
    }
    const result = JSON.parse(await run(['gh', 'api', '--method', 'GET', `repos/${repository}/actions/runs/${record.run}`]));
    assert(result.status === 'completed' && result.conclusion === 'success', 'Pagesは未完了または失敗です。同じコマンドで確認を再開してください。');
    const response = await get(page, { cache: 'no-store' });
    assert(response.ok, '公開ページを取得できません。');
    const html = await response.text();
    assert([...html.matchAll(/<time datetime="([^"]+)"/g)].some(m => m[1] >= record.startedAt), '公開ページの情報が古い状態です。');
    for (const step of plan.steps) if (step.action === 'publish' && !state.entries[step.repo].cancelled) {
      const name = step.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const row = new RegExp(`<tr[^>]*data-repo="${name}"[^>]*data-npm-version="([^"]*)"`).exec(html);
      assert.equal(row?.[1], step.nextVersion, `${step.repo}: 公開ページの版が一致しません。`);
    }
    record.complete = true;
    await writeJson(path, record);
    return { ...record, url: page, runUrl: `https://github.com/${repository}/actions/runs/${record.run}` };
  } finally { await unlock(); }
}
