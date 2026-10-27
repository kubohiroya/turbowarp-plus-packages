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

const HELP = `使い方: pnpm release --plan <plan.json> --workspace <専用dir> [--discover --repos-dir <repo群の親dir>]

既定はdry-run。入力・依存順・全対象の実行設定を検証し、操作とdigestを表示します。
--execute --confirm <digest>  dry-runと同じplan/configを実行・途中から再開
--discover --repos-dir <dir>  既存package.json/workflowを入力SHAから解決（導入中は既定OFF）
--config <file>              明示設定、またはdiscoverに対する例外
--resolved <dry-run.json>    保存したdry-runの実効設定を再利用（再解決しない）
--help                       この説明を表示

実行時は専用checkoutで依存/version更新、install/prepare/verify、pack、commit/push、
PR/CI/Squash Merge、タグ/Release、npm公開、provenance/ハッシュ/latest/next照合を直列実行。
上流の完了確認前には下流へ進みません。state.jsonと成果物をworkspaceへ保存します。
既存の利用者checkoutは変更しません。外部公開は--execute指定時のみ行います。`;

try {
  const { values, positionals } = parseArgs({ options: {
    plan: { type: 'string' }, config: { type: 'string' }, workspace: { type: 'string' },
    execute: { type: 'boolean' }, confirm: { type: 'string' }, help: { type: 'boolean' },
    discover: { type: 'boolean' }, 'repos-dir': { type: 'string' }, resolved: { type: 'string' },
  } });
  if (values.help) console.log(HELP);
  else {
    if (positionals.length || !values.plan || !values.workspace || Boolean(values.execute) !== Boolean(values.confirm) ||
        (values.resolved && (values.config || values.discover || values['repos-dir'])) ||
        (values.discover && !values['repos-dir']) || (!values.discover && values['repos-dir']) ||
        (!values.discover && !values.config && !values.resolved)) throw new Error(HELP);
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
    if (!values.execute) console.log(JSON.stringify({
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
      const state = await executeReleasePlan(plan, config, values.workspace,
        (save, state) => new GithubNpmReleaseDriver(values.workspace!, config, state, save), values.confirm!,
        (repository, phase) => console.error(`[${repository}] ${phase}`));
      console.log(JSON.stringify({ mode: 'complete', digest, state }, null, 2));
    }
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
