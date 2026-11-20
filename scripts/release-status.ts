import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { readJson } from './lib/release-io.ts';
import { errorMessage } from './lib/errors.ts';
import type { ExecutionState } from './lib/release-execution.ts';
import type { ReleasePlan } from './lib/release-plan.ts';
import { executionDigest } from './lib/release-execution.ts';
try {
  const { values: v } = parseArgs({ options: { workspace: { type: 'string' }, plan: { type: 'string' }, help: { type: 'boolean' } } });
  if (v.help) console.log('npm run release:status -- --workspace <dir> --plan <plan.json>');
  else {
    if (!v.workspace || !v.plan) throw new Error('workspaceとplanが必要です。');
    const plan: ReleasePlan = await readJson(v.plan);
    const state: ExecutionState = await readJson(join(v.workspace, 'state.json'));
    if (!state.effectiveConfig || executionDigest(plan, state.effectiveConfig) !== state.digest) throw new Error('状態と計画が一致しません。');
    const rows = plan.steps.map(step => {
      const entry = state.entries[step.repo];
      return { repository: step.repository, phase: entry?.phase ?? 'pending',
        status: entry?.error ? 'failed' : entry?.cancelled ? 'cancelled' : entry?.phase === 'complete' ? 'complete' :
          entry?.phase === 'prepared' ? 'approval' : step.dependencyUpdates.some(u => {
            const upstream = state.entries[u.upstreamRepo];
            return upstream && upstream.phase !== 'complete' && !upstream.cancelled;
          }) ? 'dependency' : 'pending', error: entry?.error, pr: entry?.prUrl, release: entry?.releaseUrl };
    });
    console.log(JSON.stringify({ digest: state.digest, rows }, null, 2));
  }
} catch (e) { console.error(errorMessage(e)); process.exitCode = 1; }
