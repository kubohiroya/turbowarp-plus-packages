import { parseArgs } from 'node:util';
import { readJson } from './lib/release-io.ts';
import { finish } from './lib/release-finish.ts';
import { errorMessage } from './lib/errors.ts';
try {
  const { values: v } = parseArgs({ options: { plan: { type: 'string' }, resolved: { type: 'string' }, workspace: { type: 'string' },
    execute: { type: 'boolean' }, confirm: { type: 'string' }, help: { type: 'boolean' } } });
  if (v.help) console.log('release:finish --plan <JSON> --resolved <preview> --workspace <dir> --execute --confirm <計画digest>');
  else {
    if (!v.plan || !v.resolved || !v.workspace || !v.execute || !v.confirm) throw new Error('Pages起動には--execute --confirmが必要です。');
    console.log(JSON.stringify(await finish(await readJson(v.plan), (await readJson(v.resolved)).effectiveConfig, v.workspace, v.confirm), null, 2));
  }
} catch (e) { console.error(errorMessage(e)); process.exitCode = 1; }
