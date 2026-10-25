#!/usr/bin/env -S npx tsx
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { applyReleasePlan } from './lib/apply-release-plan.ts';
import { errorMessage } from './lib/errors.ts';
import { createDownstreamReleasePlan, formatReleasePlan } from './lib/release-plan.ts';

const HELP = `使い方: npm run bump:downstream -- <npm名またはrepo名> [オプション]

指定パッケージを起点に、直接・間接の依存元を上流から順に処理します。
既定では計画だけを出力します。
--data <解析JSON>       既定入力: data/dashboard.json
--json                 機械可読JSONを標準出力
--apply                ローカルのpackage.jsonへ依存指定とversionを適用
--repos-dir <親dir>     --apply時に必須。<親dir>/<repo名>が各checkout
--help                 この説明を表示

適用前に全対象のHEAD SHA・name/version・依存指定・作業ツリーを確認します。
阻害事項・要レビューの変更案・未コミット変更がある場合は適用しません。
lockfile更新・再ビルド・Git書き込み・ネットワークアクセス・公開操作は行いません。
終了コード: 0=成功、1=引数/入力/適用エラー、2=計画に未解決事項あり、または適用時にレビュー必要。`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      data: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' },
      apply: { type: 'boolean' }, 'repos-dir': { type: 'string' },
    },
  });
  if (values.help) {
    console.log(HELP);
  } else {
    if (positionals.length !== 1 || !positionals[0]) throw new Error(HELP);
    if (Boolean(values.apply) !== Boolean(values['repos-dir'])) {
      throw new Error('--applyと--repos-dirは同時に指定してください。');
    }
    const path = values.data ?? fileURLToPath(new URL('../data/dashboard.json', import.meta.url));
    let source: string;
    try {
      source = await readFile(path, 'utf8');
    } catch (error) {
      throw new Error(`解析JSONを読み込めません: ${path}。--dataで入力を指定してください。`, { cause: error });
    }
    const plan = createDownstreamReleasePlan(JSON.parse(source), positionals[0]);
    if (!plan.ready || (values.apply && !plan.applyReady)) {
      console.log(values.json ? JSON.stringify(plan, null, 2) : formatReleasePlan(plan));
      process.exitCode = 2;
    } else if (values.apply) {
      const files = await applyReleasePlan(plan, values['repos-dir']!);
      console.log(values.json ? JSON.stringify({ mode: 'apply', plan, files }, null, 2) :
        `ローカル適用完了: ${files.length}件のpackage.jsonを更新しました。\n${files.join('\n')}\nlockfile更新・再ビルド・公開は別途必要です。`);
    } else {
      console.log(values.json ? JSON.stringify(plan, null, 2) : formatReleasePlan(plan));
    }
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
