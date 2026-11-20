#!/usr/bin/env -S npx tsx
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { errorMessage } from './lib/errors.ts';
import { GithubNpmReleaseDriver } from './lib/release-driver.ts';
import { executeReleasePlan, executionDigest, PHASES } from './lib/release-execution.ts';
import type { ExecutionConfig } from './lib/release-execution.ts';
import type { ReleasePlan } from './lib/release-plan.ts';
import { localContractReader, resolveContracts, trustedConfig } from './lib/release-contract.ts';
import { createBundle, verifyBundle } from './lib/release-candidates.ts';

const HELP = `使い方: pnpm release --plan <plan.json> --workspace <専用dir> [--discover --repos-dir <repo群の親dir>]

既定はdry-run。入力・依存順・全対象の実行設定を検証し、操作とdigestを表示します。
--execute --confirm <digest>  dry-runと同じplan/configを実行・途中から再開
--discover --repos-dir <dir>  既存package.json/workflowを入力SHAから解決（導入中は既定OFF）
--config <file>              明示設定、またはdiscoverに対する例外
--resolved <dry-run.json>    保存したdry-runの実効設定を再利用（再解決しない）
--concurrency <n>            依存先が終わった対象を同時にn件まで進める（既定4。1で従来どおり直列）
--reference-dir <dir>        <dir>/<repo名>に既存のcheckoutがあれば、専用checkoutのcloneでそのオブジェクトを借りる
                             （git clone --reference-if-able。既存checkoutは読むだけで変更しない）
--help                       この説明を表示
--prepare                    公開せず、実行可能な候補を準備・検証
--candidates <JSON>           承認済み候補だけを実行（confirmは候補digest）
--lock-dir <dir>              共通lock（既定はdata/release-locks）

実行時は専用checkoutで依存/version更新、install/prepare/verify、commit/push、
PR/CI/Squash Merge、タグ/Release、npm公開（tarballは扱わない）、provenance/公開元commit/latest/next照合を対象ごとに実行。
依存先の完了確認前にはその対象へ進みません。依存しあわない対象は並列に進みます。state.jsonと成果物をworkspaceへ保存します。
既存の利用者checkoutは変更しません。外部公開は--execute指定時のみ行います。`;

try {
  const { values, positionals } = parseArgs({ options: {
    plan: { type: 'string' }, config: { type: 'string' }, workspace: { type: 'string' },
    execute: { type: 'boolean' }, confirm: { type: 'string' }, help: { type: 'boolean' },
    discover: { type: 'boolean' }, 'repos-dir': { type: 'string' }, resolved: { type: 'string' },
    concurrency: { type: 'string' }, 'reference-dir': { type: 'string' },
    prepare: { type: 'boolean' }, candidates: { type: 'string' }, 'lock-dir': { type: 'string' },
  } });
  if (values.help) console.log(HELP);
  else {
    if (positionals.length || !values.plan || !values.workspace || Boolean(values.execute) !== Boolean(values.confirm) ||
        (values.prepare && values.execute) || (values.candidates && !values.execute) ||
        (values.resolved && (values.config || values.discover || values['repos-dir'])) ||
        (values.discover && !values['repos-dir']) || (!values.discover && values['repos-dir']) ||
        (!values.discover && !values.config && !values.resolved) ||
        (values.concurrency !== undefined && !/^[1-9][0-9]*$/u.test(values.concurrency))) throw new Error(HELP);
    const plan = JSON.parse(await readFile(values.plan, 'utf8')) as ReleasePlan;
    let config: ExecutionConfig;
    if (values.resolved) {
      const preview = JSON.parse(await readFile(values.resolved, 'utf8'));
      if (preview.mode !== 'dry-run' || !preview.effectiveConfig ||
          preview.digest !== executionDigest(plan, preview.effectiveConfig)) throw new Error('保存したdry-runとplan/configのdigestが不一致です。');
      config = trustedConfig(preview.effectiveConfig);
    } else {
      const overrides = values.config ? JSON.parse(await readFile(values.config, 'utf8')) as ExecutionConfig : undefined;
      config = values.discover ? resolveContracts(plan, localContractReader(values['repos-dir']!), overrides) : trustedConfig(overrides!);
    }
    const digest = executionDigest(plan, config);
    if (!values.execute && !values.prepare) console.log(JSON.stringify({
      mode: 'dry-run', digest, workspace: resolve(values.workspace),
      effectiveConfig: config,
      phases: PHASES.slice(1),
      steps: plan.steps.map(step => ({
        repository: step.repository, action: step.action, inputSha: step.headSha,
        version: step.nextVersion ?? step.publishedVersion ?? step.currentVersion,
        dependencies: step.dependencyUpdates, profile: config.repositories[step.repository],
      })),
      note: 'ネットワーク・ファイル更新・外部公開は未実行です。実行時にmain/npm/契約を再確認します。--resolvedでこの出力を指定すると同じ実効設定で再開できます。',
    }, null, 2));
    else {
      const bundle = values.candidates ? await verifyBundle(plan, config, values.workspace, values.candidates, values.confirm!) : undefined;
      const state = await executeReleasePlan(plan, config, values.workspace,
        (save, state) => new GithubNpmReleaseDriver(values.workspace!, config, state, save, undefined, undefined,
          { referenceDir: values['reference-dir'], verifyOnly: values.prepare }), bundle || values.prepare ? digest : values.confirm!,
        (repository, phase) => console.error(`[${repository}] ${phase}`), Number(values.concurrency ?? 4), {
          prepareOnly: values.prepare, lockDir: values['lock-dir'] ?? new URL('../data/release-locks', import.meta.url).pathname,
          ...(bundle ? { selected: bundle.candidates.map(c => c.repo), beforeRun: async () => {
            await verifyBundle(plan, config, values.workspace!, values.candidates!, values.confirm!);
          } } : {}),
        });
      console.log(JSON.stringify(values.prepare ? await createBundle(plan, config, values.workspace, state) : { mode: 'complete', digest, state }, null, 2));
    }
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
