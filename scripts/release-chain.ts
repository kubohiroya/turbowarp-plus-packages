import { parseArgs } from 'node:util';
import { createChain } from './lib/release-chain.ts';
import { errorMessage } from './lib/errors.ts';
const HELP = `使い方: npm run release:chain -- <起点>... --workspace <新規dir>
--data <JSON>  収集済みsnapshotを使う
--upstream    上流をたどる（起点1つ）
--reconcile   公開基点の不一致を新しい版で揃える
--config <JSON>  例外設定
--reference-dir <dir>  cloneの参照元
公開せず、plan.json・preview.jsonを保存します。`;
try {
  const { values: v, positionals } = parseArgs({ allowPositionals: true, options: {
    workspace: { type: 'string' }, data: { type: 'string' }, upstream: { type: 'boolean' }, reconcile: { type: 'boolean' },
    config: { type: 'string' }, 'reference-dir': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (v.help) console.log(HELP);
  else {
    if (!v.workspace || !positionals.length || (v.upstream && positionals.length !== 1)) throw new Error(HELP);
    console.log(JSON.stringify(await createChain({ workspace: v.workspace, data: v.data, upstream: v.upstream,
      reconcile: v.reconcile, config: v.config, referenceDir: v['reference-dir'], roots: positionals }), null, 2));
  }
} catch (e) { console.error(errorMessage(e)); process.exitCode = 1; }
