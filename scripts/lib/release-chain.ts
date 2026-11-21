import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createReleasePlan, createDownstreamReleasePlan } from './release-plan.ts';
import { resolveContracts } from './release-contract.ts';
import { executionDigest, PHASES } from './release-execution.ts';
import { runCommand } from './release-driver.ts';
import type { Runner } from './release-driver.ts';
import { readJson, writeJson } from './release-io.ts';

export async function createChain(options: { workspace: string; data?: string; roots: string[]; upstream?: boolean;
  reconcile?: boolean; patch?: boolean; config?: string; referenceDir?: string }, run: Runner = runCommand) {
  // Exclusive creation prevents accidental reuse, including after an interrupted run.
  await mkdir(options.workspace);
  try {
    if (!options.data) await run([process.execPath, '--import', 'tsx', new URL('../collect.ts', import.meta.url).pathname,
      '--output', join(options.workspace, 'collected.json')]);
    const snapshot = await readJson(options.data ?? join(options.workspace, 'collected.json'));
    await writeJson(join(options.workspace, 'snapshot.json'), snapshot);
    const plan = options.upstream ? createReleasePlan(snapshot, options.roots[0], { reconcile: options.reconcile, patch: options.patch }) :
      createDownstreamReleasePlan(snapshot, options.roots, { reconcile: options.reconcile, patch: options.patch });
    await writeJson(join(options.workspace, 'plan.json'), plan);
    if (!plan.ready) throw new Error('計画に未解決事項があります。plan.jsonを確認してください。');
    const sources = join(options.workspace, 'sources');
    await mkdir(sources);
    for (const step of plan.steps) {
      const target = join(sources, step.repo);
      const reference = options.referenceDir ? ['--reference-if-able', options.referenceDir + '/' + step.repo] : [];
      await run(['git', 'clone', '--no-checkout', '--filter=blob:none', ...reference, `https://github.com/${step.repository}.git`, target]);
      await run(['git', 'fetch', 'origin', step.headSha!], { cwd: target });
    }
    const { localContractReader } = await import('./release-contract.ts');
    const config = resolveContracts(plan, localContractReader(sources), options.config ? await readJson(options.config) : undefined);
    const preview = { mode: 'dry-run', digest: executionDigest(plan, config), effectiveConfig: config,
      phases: PHASES.slice(1), steps: plan.steps, workspace: join(options.workspace, 'execution') };
    await writeJson(join(options.workspace, 'preview.json'), preview);
    await writeJson(join(options.workspace, 'result.json'), { mode: 'ready', digest: preview.digest });
    return preview;
  } catch (error) {
    await writeJson(join(options.workspace, 'result.json'), { mode: 'failed', error: String(error) });
    throw error;
  }
}
