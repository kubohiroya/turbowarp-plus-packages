#!/usr/bin/env -S npx tsx
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { errorMessage } from './lib/errors.ts';
import { createReleasePlan, formatReleasePlan } from './lib/release-plan.ts';

const HELP = `使い方: npm run bump -- <npm名またはrepo名> [--data <解析JSON>] [--json]

指定パッケージと上流のリリース計画を出力します。
既定入力: data/dashboard.json
--data   別の解析スナップショットを使用
--json   機械可読JSONを標準出力（保存時は npm run --silent bump -- ... --json）
--help   この説明を表示

ネットワークアクセス・対象repoの変更・公開操作は行いません。
終了コード: 0=計画生成成功、1=引数/入力エラー、2=計画に未解決事項あり。`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { data: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(HELP);
  } else {
    if (positionals.length !== 1 || !positionals[0]) throw new Error(HELP);
    const path = values.data ?? fileURLToPath(new URL('../data/dashboard.json', import.meta.url));
    let source: string;
    try {
      source = await readFile(path, 'utf8');
    } catch (error) {
      throw new Error(`解析JSONを読み込めません: ${path}。既存のdashboard.jsonを配置するか --data で指定してください。`, { cause: error });
    }
    const plan = createReleasePlan(JSON.parse(source), positionals[0]);
    console.log(values.json ? JSON.stringify(plan, null, 2) : formatReleasePlan(plan));
    if (!plan.ready) process.exitCode = 2;
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
