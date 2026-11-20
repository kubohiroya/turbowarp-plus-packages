import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pool } from './github.ts';
import { runCommand } from './release-driver.ts';
import type { Runner } from './release-driver.ts';
import { hash, readJson, writeJson, lockRepositories, defaultLockDir } from './release-io.ts';
import type { ReleasePlan } from './release-plan.ts';
import type { DashboardReport } from './types.ts';

export async function tasks(plan: ReleasePlan, snapshot: DashboardReport, directory: string, sources: string,
  worker?: string[], run: Runner = runCommand) {
  assert.equal(hash(snapshot), plan.snapshot.sha256, 'snapshotと計画が異なります。');
  directory = resolve(directory);
  sources = resolve(sources);
  assert(plan.steps.every(s => /^[\w.-]+\/[\w.-]+$/.test(s.repository) && s.repository.split('/')[1] === s.repo &&
    !['.', '..'].includes(s.repo) && /^[a-f0-9]{40}$/.test(s.headSha!)));
  await mkdir(directory);
  const names = new Map(snapshot.packages.map(p => [p.manifest?.name, p.repo]));
  const jobs = plan.steps.map(s => ({ repository: s.repository, repo: s.repo, inputSha: s.headSha,
    dependencies: (snapshot.packages.find(p => p.repo === s.repo)?.dependencies ?? []).filter(d => d.family)
      .map(d => names.get(d.name)).filter((n): n is string => Boolean(n)),
    status: 'pending', findings: null as unknown }));
  const save = () => writeJson(join(directory, 'tasks.json'), { schemaVersion: 1, planHash: hash(plan), jobs });
  await save();
  await pool(jobs, 3, async job => {
    let unlock = async () => {};
    try {
      unlock = await lockRepositories(defaultLockDir, [job.repository], directory);
      const cwd = join(directory, job.repo);
      await run(['git', 'clone', '--no-hardlinks', '--no-checkout', join(sources, job.repo), cwd]);
      await run(['git', 'checkout', '--detach', job.inputSha!], { cwd });
      const assignment = { ...job, checkout: cwd, planHash: hash(plan),
        instructions: '調査・ローカル修正・検証のみ。push、PR、merge、タグ、npm公開は禁止。state.jsonやreviewedRepositoriesは変更しない。根拠と未検証事項を返す。',
        resultSchema: { repository: job.repository, inputSha: job.inputSha, findings: ['根拠を含む説明'], tests: ['実行結果'], requiresReview: true } };
      const file = join(directory, job.repo + '.json');
      await writeJson(file, assignment);
      if (worker) {
        job.status = 'running';
        await run([...worker, file, join(directory, job.repo + '.result.json')], { cwd });
        const result = await readJson(join(directory, job.repo + '.result.json'));
        assert(result.repository === job.repository && result.inputSha === job.inputSha &&
          Array.isArray(result.findings) && Array.isArray(result.tests), 'worker結果の対象が不正です。');
        job.findings = { ...result, requiresReview: true };
        job.status = 'review';
      } else job.status = 'assigned';
    } catch (error) { job.status = 'failed'; job.findings = String(error); }
    finally { await unlock(); }
  });
  // Persist once after all workers, avoiding concurrent writes to the same file.
  await save();
  return jobs;
}
