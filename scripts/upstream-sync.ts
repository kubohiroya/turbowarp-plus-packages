#!/usr/bin/env -S npx tsx
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { errorMessage } from './lib/errors.ts';
import {
  DEFAULT_TARGETS, candidateDigest, formatReport, publishCandidate, readState, spawnRunner, syncCandidate, verified,
  type SyncState,
} from './lib/upstream-sync.ts';

const HELP = `使い方: npm run upstream:sync -- --repos-dir <親dir> [オプション]

TurboWarp Plus Editor の本家追従の候補を作り、検証して報告します。
  1. scratch-vm / scratch-gui のフォーク develop から chore/upstream/merge-<id> を切り、本家 develop をマージ
  2. 本家 TurboWarp/packager の master を新しい固定値の候補にする
  3. plus-editor の site/source.json を書き換え（guiRevision / vmRevision / vmBaseRevision / packagerRevision）、
     chore/upstream/sync-<id> にローカルコミット
  4. フォークのテストと plus-editor の CI 相当（typecheck・test・GUI 結合・build:pages）を1回ずつ実行
  5. 報告を <作業dir>/<id>/report.md に書き、標準出力にも出す
既定では push も PR 作成もしません。

--repos-dir <親dir>   必須。<親dir>/scratch-gui などの checkout を使う。無いものは作業dirへ clone する
--work-dir <dir>     候補を置く場所。既定: <親dir>/.upstream-sync
--id <名前>          候補の名前（ブランチ名・作業dir名）。既定: 今日の日付。同じ id で再実行すると続きから進む
--merge-only         マージと固定値の書き換えまでで止め、検証しない
--e2e                ブラウザーを使う検証（scratch-gui の test:integration と plus-editor の test:e2e）も行う。
                     実マウスを動かす E2E は行わない
--publish            検証が全件成功した候補を、1件ずつ確認を取りながら push して PR を作る（対話端末が必要）
--json               報告の代わりに状態を JSON で出す
--help               この説明を表示

衝突したら worktree を残して止まります。解決してコミットしたあと、同じ --id で再実行してください。
成功済みで入力が変わらない検証手順は走らせ直しません。
終了コード: 0=候補の検証まで成功（または追従するもの無し）、1=エラー、2=衝突・検証失敗・未完了。`;

const today = () => new Date().toISOString().slice(0, 10);

function exitCode(state: SyncState): number {
  const conflicted = [state.forks.vm, state.forks.gui].some((fork) => fork?.status === 'conflict');
  const nothing = state.pins !== null && state.pins.changes.length === 0 && state.forks.vm?.status !== 'merged';
  if (conflicted) return 2;
  if (nothing) return 0;
  return verified(state) ? 0 : 2;
}

try {
  const { values } = parseArgs({
    options: {
      'repos-dir': { type: 'string' }, 'work-dir': { type: 'string' }, id: { type: 'string' },
      'merge-only': { type: 'boolean' }, e2e: { type: 'boolean' }, publish: { type: 'boolean' },
      json: { type: 'boolean' }, help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(HELP);
  } else {
    if (!values['repos-dir']) throw new Error(HELP);
    if (values.publish && values['merge-only']) throw new Error('--publish と --merge-only は同時に指定できません。');
    if (values.publish && !process.stdin.isTTY) throw new Error('--publish は確認を取るため対話端末で実行してください。');
    const id = values.id ?? today();
    if (!/^[\w.-]+$/.test(id)) throw new Error(`--id に使えない文字があります: ${id}`);
    const reposDir = resolve(values['repos-dir']);
    const options = {
      reposDir, workRoot: resolve(values['work-dir'] ?? join(reposDir, '.upstream-sync')), id,
      e2e: Boolean(values.e2e), mergeOnly: Boolean(values['merge-only']), targets: DEFAULT_TARGETS,
      runner: spawnRunner, log: (line: string) => console.error(`[upstream-sync] ${line}`),
    };
    let state = await syncCandidate(options);
    if (values.publish && exitCode(state) === 0 && !(state.pins?.changes.length === 0 && state.forks.vm?.status !== 'merged')) {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        await publishCandidate(options, state, async (question) => /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim()));
      } finally {
        rl.close();
      }
      state = (await readState(state.workDir)) ?? state;
    }
    const report = formatReport(state);
    await writeFile(join(state.workDir, 'report.md'), report);
    console.log(values.json ? JSON.stringify({ digest: candidateDigest(state), ...state }, null, 2) : report);
    console.error(`[upstream-sync] 報告: ${join(state.workDir, 'report.md')}`);
    process.exitCode = exitCode(state);
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
