import { parseArgs } from 'node:util';
import { readJson } from './lib/release-io.ts';
import { tasks } from './lib/release-tasks.ts';
import { errorMessage } from './lib/errors.ts';
try {
  const { values: v } = parseArgs({ options: { plan: { type: 'string' }, snapshot: { type: 'string' },
    'repos-dir': { type: 'string' }, output: { type: 'string' }, worker: { type: 'string' }, help: { type: 'boolean' } } });
  if (v.help) console.log('release:tasks --plan <JSON> --snapshot <JSON> --repos-dir <dir> --output <新規dir> [--worker <command配列のJSON>]');
  else {
    if (!v.plan || !v.snapshot || !v['repos-dir'] || !v.output) throw new Error('引数が不足しています。');
    const worker = v.worker ? await readJson(v.worker) : undefined;
    if (worker && (!Array.isArray(worker) || !worker.length || worker.some((v: unknown) => typeof v !== 'string'))) throw new Error('workerにはコマンド配列が必要です。');
    const jobs = await tasks(await readJson(v.plan), await readJson(v.snapshot), v.output, v['repos-dir'], worker);
    console.log(JSON.stringify(jobs, null, 2));
    if (jobs.some(j => j.status === 'failed')) process.exitCode = 2;
  }
} catch (e) { console.error(errorMessage(e)); process.exitCode = 1; }
