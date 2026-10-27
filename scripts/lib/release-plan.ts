import { createHash } from 'node:crypto';
import semver from 'semver';
import { DEPENDENCY_KINDS } from './dependencies.ts';
import type { DashboardPackage, DashboardReport, Dependency } from './types.ts';

type DependencyField = keyof typeof DEPENDENCY_KINDS;
type VersionChange = 'none' | 'minor' | 'prerelease' | 'prepared' | 'initial';

export interface PlanIssue {
  severity: 'warning' | 'blocker';
  code: string;
  message: string;
  requiresReview?: boolean;
}

export interface DependencyUpdate {
  field: DependencyField;
  name: string;
  upstreamRepo: string;
  from: string;
  to: string | null;
  targetVersion: string;
  source: 'planned' | 'published';
}

export interface PackagePlan {
  repo: string;
  repository: string;
  name: string | null;
  headSha: string | null;
  currentVersion: string | null;
  publishedVersion: string | null;
  nextVersion: string | null;
  versionChange: VersionChange;
  sourceChanges: 'none' | 'ahead' | 'unknown';
  action: 'none' | 'publish' | 'update-only' | 'blocked';
  reasons: string[];
  dependencyUpdates: DependencyUpdate[];
  issues: PlanIssue[];
}

export interface ReleasePlan {
  schemaVersion: 1;
  mode: 'plan';
  direction?: 'downstream';
  reconcile?: true;
  snapshot: { generatedAt: string; sha256: string };
  target: string;
  ready: boolean;
  applyReady: boolean;
  order: string[];
  steps: PackagePlan[];
  publishTargets: { repository: string; name: string; version: string; tag: string; headSha: string }[];
}

const FIELDS = Object.keys(DEPENDENCY_KINDS) as DependencyField[];
const KINDS = Object.values(DEPENDENCY_KINDS);
const STATES = ['empty', 'untagged', 'released', 'unreleased'];
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const nullableText = (value: unknown) => value == null || text(value);

/** Validate the fields consumed by the planner; leave dashboard-only fields alone. */
function snapshot(value: unknown): DashboardReport {
  if (!object(value) || !text(value.owner) || !text(value.scope) ||
      !text(value.generatedAt) || !Number.isFinite(Date.parse(value.generatedAt)) ||
      !Array.isArray(value.packages)) {
    throw new Error('解析JSONには owner・scope・generatedAt・packages が必要です。');
  }
  for (const pkg of value.packages) {
    const invalid = () => new Error(`解析JSONのパッケージ情報が不正です: ${object(pkg) ? pkg.repo : '?'}`);
    if (!object(pkg) || !text(pkg.repo) || !strings(pkg.errors)) throw invalid();
    if (pkg.manifest != null && (!object(pkg.manifest) ||
        !nullableText(pkg.manifest.name) || !nullableText(pkg.manifest.version) ||
        typeof pkg.manifest.private !== 'boolean')) throw invalid();
    if (pkg.npm != null && (!object(pkg.npm) || !nullableText(pkg.npm.name) ||
        typeof pkg.npm.published !== 'boolean' || !nullableText(pkg.npm.latest) ||
        (pkg.npm.notAPackage !== undefined && typeof pkg.npm.notAPackage !== 'boolean') ||
        (pkg.npm.versions !== undefined && !strings(pkg.npm.versions)))) throw invalid();
    if (pkg.revision != null && (!object(pkg.revision) || !STATES.includes(String(pkg.revision.state)) ||
        (pkg.revision.aheadBy != null && (!Number.isInteger(pkg.revision.aheadBy) || Number(pkg.revision.aheadBy) < 0)) ||
        (pkg.revision.head != null && (!object(pkg.revision.head) || !text(pkg.revision.head.oid))) ||
        (pkg.revision.tag != null && (!object(pkg.revision.tag) || !text(pkg.revision.tag.name) ||
          !nullableText(pkg.revision.tag.oid))))) throw invalid();
    if (pkg.dependencies !== undefined && (!Array.isArray(pkg.dependencies) ||
        pkg.dependencies.some((dep: unknown) => !object(dep) || !text(dep.name) ||
          !text(dep.range) || !KINDS.includes(dep.kind as Dependency['kind']) ||
          typeof dep.family !== 'boolean'))) throw invalid();
    if (pkg.github != null && (!object(pkg.github) ||
        typeof pkg.github.isArchived !== 'boolean')) throw invalid();
  }
  return value as unknown as DashboardReport;
}

function packageName(pkg: DashboardPackage): string | null {
  return pkg.npm?.name ?? pkg.manifest?.name ?? null;
}

function isPublishable(pkg: DashboardPackage): boolean {
  return Boolean(pkg.npm?.name && !pkg.npm.notAPackage && !pkg.manifest?.private);
}

/** Only replace Git references that identify the recorded upstream repository. */
function familyGitReference(range: string, owner: string, repo: string): boolean {
  try {
    const url = new URL(range.replace(/^git\+/, ''));
    return ['https:', 'ssh:', 'git:'].includes(url.protocol) && url.hostname === 'github.com' &&
      url.pathname.replace(/^\//, '').replace(/\.git$/, '') === `${owner}/${repo}` && !url.search;
  } catch {
    return false;
  }
}

/** Pure snapshot planning: no API requests, repository writes or release commands. */
export function createReleasePlan(input: unknown, target: string, options: { reconcile?: boolean } = {}): ReleasePlan {
  return createPlan(input, target, false, options.reconcile ?? false);
}

/** Discover dependents first, then plan their updates in dependency order. */
export function createDownstreamReleasePlan(input: unknown, target: string, options: { reconcile?: boolean } = {}): ReleasePlan {
  return createPlan(input, target, true, options.reconcile ?? false);
}

function createPlan(input: unknown, target: string, downstream: boolean, reconcile: boolean): ReleasePlan {
  const report = snapshot(input);
  const repos = new Map<string, DashboardPackage>();
  const names = new Map<string, DashboardPackage>();
  for (const pkg of report.packages) {
    if (repos.has(pkg.repo)) throw new Error(`リポジトリが重複しています: ${pkg.repo}`);
    repos.set(pkg.repo, pkg);
    for (const name of new Set([pkg.npm?.name, pkg.manifest?.name].filter(text))) {
      if (names.has(name) && names.get(name) !== pkg) throw new Error(`npm名が重複しています: ${name}`);
      names.set(name, pkg);
    }
  }
  const matches = new Set([repos.get(target), names.get(target)].filter((p) => p !== undefined));
  if (matches.size !== 1) throw new Error(`パッケージ名が不明または曖昧です: ${target}`);
  const root = [...matches][0];
  const affected = downstream ? new Set([root.repo]) : undefined;
  if (affected) {
    const dependents = new Map<string, Set<string>>();
    for (const pkg of report.packages) {
      if (!pkg.dependencies) throw new Error(`${pkg.repo}: 依存一覧がなく、依存元を確定できません。`);
      for (const dep of (pkg.dependencies ?? []).filter((dep) => dep.family)) {
        const upstream = names.get(dep.name);
        if (!upstream) continue; // The ordered traversal rejects missing selected upstreams.
        const entries = dependents.get(upstream.repo) ?? new Set<string>();
        entries.add(pkg.repo);
        dependents.set(upstream.repo, entries);
      }
    }
    for (const repo of affected) {
      for (const dependent of dependents.get(repo) ?? []) affected.add(dependent);
    }
  }
  const ordered: DashboardPackage[] = [];
  const done = new Set<string>();
  const path: string[] = [];
  function visit(pkg: DashboardPackage): void {
    if (done.has(pkg.repo)) return;
    if (path.includes(pkg.repo)) {
      throw new Error(`循環依存: ${[...path.slice(path.indexOf(pkg.repo)), pkg.repo].join(' → ')}`);
    }
    path.push(pkg.repo);
    const dependencies = (pkg.dependencies ?? []).filter((dep) => dep.family)
      .sort((a, b) => compare(a.name, b.name) || compare(a.kind, b.kind));
    for (const dep of dependencies) {
      const upstream = names.get(dep.name);
      if (!upstream) throw new Error(`${pkg.repo}: 解析JSONに上流パッケージがありません: ${dep.name}`);
      visit(upstream);
    }
    path.pop();
    done.add(pkg.repo);
    ordered.push(pkg);
  }
  visit(root);
  if (affected) {
    for (const repo of [...affected].sort(compare)) visit(repos.get(repo)!);
  }

  const planned = new Map<string, PackagePlan>();
  for (const pkg of ordered) {
    const step = planPackage(report.owner, pkg, names, planned, affected, reconcile);
    planned.set(pkg.repo, step);
  }
  const steps = [...planned.values()].filter((step) => !affected || affected.has(step.repo));
  return {
    schemaVersion: 1,
    mode: 'plan',
    ...(reconcile ? { reconcile: true as const } : {}),
    ...(downstream ? { direction: 'downstream' as const } : {}),
    snapshot: {
      generatedAt: report.generatedAt,
      sha256: createHash('sha256').update(JSON.stringify(report)).digest('hex'),
    },
    target: root.repo,
    ready: steps.every((step) => step.action !== 'blocked'),
    applyReady: steps.every((step) => step.action !== 'blocked' && !step.issues.some(issue => issue.requiresReview)),
    order: steps.map((step) => step.repo),
    steps,
    publishTargets: steps.flatMap((step) => step.action === 'publish' && step.name &&
      step.nextVersion && step.headSha ? [{
        repository: step.repository, name: step.name, version: step.nextVersion,
        tag: `v${step.nextVersion}`, headSha: step.headSha,
      }] : []),
  };
}

function planPackage(
  owner: string,
  pkg: DashboardPackage,
  names: Map<string, DashboardPackage>,
  planned: Map<string, PackagePlan>,
  affected?: ReadonlySet<string>,
  reconcile = false,
): PackagePlan {
  const referenceOnly = affected !== undefined && !affected.has(pkg.repo);
  const step: PackagePlan = {
    repo: pkg.repo, repository: `${owner}/${pkg.repo}`, name: packageName(pkg),
    headSha: pkg.revision?.head?.oid ?? null,
    currentVersion: pkg.manifest?.version ?? null,
    publishedVersion: pkg.npm?.published ? pkg.npm.latest ?? null : null,
    nextVersion: null, versionChange: 'none', sourceChanges: 'unknown', action: 'none',
    reasons: [], dependencyUpdates: [], issues: [],
  };
  const issue = (code: string, message: string, severity: PlanIssue['severity'] = 'blocker') =>
    step.issues.push({ severity, code, message });
  const review = (code: string, message: string) =>
    step.issues.push({ severity: 'warning', code, message, requiresReview: true });
  for (const error of pkg.errors) issue('collection-error', error);
  if (!pkg.npm || !pkg.dependencies || !pkg.revision) issue('incomplete-snapshot', '公開状態・依存一覧・リビジョンの収集結果が不足しています。');
  if (pkg.npm && ((!pkg.npm.name && !pkg.npm.notAPackage) ||
      (pkg.npm.published && pkg.npm.notAPackage))) issue('inconsistent-npm-status', 'npm名と公開状態の収集結果が矛盾しています。');
  if (!step.headSha) issue('missing-head', '対象コミットのSHAがありません。');
  if (pkg.npm?.name && pkg.manifest?.name !== pkg.npm.name) issue('name-mismatch', 'manifestとnpmのパッケージ名が一致しません。');
  if (isPublishable(pkg) && !pkg.manifest) issue('missing-manifest', 'package.jsonの収集結果がありません。');
  if (pkg.npm?.published && !semver.valid(step.publishedVersion)) issue('invalid-published-version', 'npm公開バージョンが不明または不正です。');
  if (step.currentVersion && !semver.valid(step.currentVersion)) issue('invalid-version', 'package.jsonのバージョンが不正です。');
  if (isPublishable(pkg) && !step.currentVersion) issue('missing-version', 'package.jsonのバージョンがありません。');

  const current = semver.valid(step.currentVersion);
  const published = semver.valid(step.publishedVersion);
  const versions = pkg.npm?.versions ?? [];
  const tag = pkg.revision?.tag;
  // A coercible fragment in an arbitrary tag does not identify an npm release.
  const tagVersion = semver.valid(tag?.name);
  const tagMatchesPublication = Boolean(published && tagVersion === published && tag?.oid);
  const canAssessSource = !isPublishable(pkg) || !pkg.npm?.published || tagMatchesPublication;
  if (!canAssessSource) {
    issue('publication-baseline',
      'npm公開版に対応するタグのSHAがなく、ソース変更は未判定です。既存npm版を利用し、先行コミットを根拠としたbumpは計画しません。',
      'warning');
    // Releasing a new version establishes a verified baseline without inventing old tags.
    if (reconcile && !referenceOnly) step.reasons.push('github-registration');
  } else if (step.headSha && tag?.oid === step.headSha) {
    step.sourceChanges = 'none';
  } else if (pkg.revision?.state === 'unreleased') {
    if (pkg.revision.aheadBy != null && pkg.revision.aheadBy > 0) {
      step.sourceChanges = 'ahead';
    } else issue('revision-review', 'タグとHEADが異なりますが、先行コミット数が不明なためソース変更は未判定です。', 'warning');
  }

  for (const dep of (pkg.dependencies ?? []).filter((dep) => dep.family)) {
    const upstream = names.get(dep.name)!;
    const upstreamPlan = planned.get(upstream.repo)!;
    if (upstreamPlan.action === 'blocked') issue('upstream-blocked', `${dep.name}: 上流の計画に未解決事項があります。`);
    const plannedRelease = isPublishable(upstream) && upstreamPlan.versionChange !== 'none';
    const version = plannedRelease ? upstreamPlan.nextVersion : upstreamPlan.publishedVersion;
    if (!version || !semver.valid(version)) {
      issue('upstream-unavailable', `${dep.name}: 利用できる公開版または公開予定版がありません。`);
      continue;
    }
    if (referenceOnly || (affected && !affected.has(upstream.repo))) continue;
    const range = dep.range.trim();
    if (dep.kind === 'peer' && semver.satisfies(version, range)) continue;
    const match = /^(\^|~)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(range);
    const simple = match && semver.valid(match[2]) ? match : null;
    if (simple && semver.gt(simple[2], version)) {
      issue('dependency-ahead', `${dep.name}: 依存指定 ${range} が解析結果の ${version} より新しいため下げられません。`);
      continue;
    }
    if (simple && range === `${simple[1] ?? ''}${version}`) continue;
    if (!simple && dep.kind !== 'peer' && semver.validRange(range) && semver.satisfies(version, range)) continue;
    let to = simple ? `${simple[1] ?? ''}${version}` : null;
    if (dep.kind === 'peer' && (simple || semver.validRange(range))) {
      to ??= `${range} || ${version}`;
      review('peer-compatibility', `${dep.name}: ${range} → ${to} を提案します。対象版との互換性は未検証です。`);
    } else if (to === null && upstream.npm?.published && familyGitReference(range, owner, upstream.repo)) {
      to = version;
      review('git-to-npm', `${dep.name}: Git参照をnpm版 ${version} に置換する案です。Git固有の変更・配布内容の同等性は未検証です。`);
    }
    step.dependencyUpdates.push({
      field: FIELDS.find((field) => DEPENDENCY_KINDS[field] === dep.kind)!,
      name: dep.name, upstreamRepo: upstream.repo, from: dep.range, to,
      targetVersion: version, source: plannedRelease ? 'planned' : 'published',
    });
    if (to === null) issue('range-review', `${dep.name}: ${dep.kind === 'peer' ? 'peer互換性' : '依存指定'} ${range} → ${version} の変更方法を確認してください。`);
  }
  if (step.dependencyUpdates.length) step.reasons.push('dependency-update');
  if (!referenceOnly && step.sourceChanges === 'ahead') step.reasons.push('commits-ahead');
  if (!referenceOnly && isPublishable(pkg) && pkg.npm?.published === false) step.reasons.push('unpublished');

  if (pkg.npm?.published && !pkg.npm.versions) {
    issue('incomplete-version-list', '公開済みバージョン一覧がなく、予定バージョンの未使用を確認できません。');
  }
  if (published && pkg.npm?.versions && !versions.includes(published)) {
    issue('inconsistent-registry', 'npm公開版が公開済みバージョン一覧にありません。');
  }
  const prepared = Boolean(current && published && semver.gt(current, published) && !versions.includes(current));
  if (prepared && !referenceOnly) {
    step.reasons.push('prepared-version');
  }

  if (step.reasons.length && current) {
    const base = published && semver.gt(published, current) ? published : current;
    if (prepared) {
      step.nextVersion = current;
      step.versionChange = 'prepared';
    } else if (!pkg.npm?.published && isPublishable(pkg)) {
      step.nextVersion = current;
      step.versionChange = 'initial';
    } else {
      const increment = semver.prerelease(base) ? 'prerelease' : 'minor';
      // Do not implicitly promote an older RC manifest beyond a stable registry version.
      const implicitPromotion = Boolean(semver.prerelease(current) && increment === 'minor');
      let next = implicitPromotion ? null : semver.inc(base, increment);
      while (next && semver.valid(next) && versions.includes(next)) next = semver.inc(next, increment);
      if (next && semver.valid(next)) {
        step.nextVersion = next;
        step.versionChange = increment;
      } else if (implicitPromotion) issue('prerelease-series', 'RC系列より新しい通常版が公開済みのため、同じ系列での更新を計画できません。');
      else issue('version-overflow', `${increment}バージョンを採番できません。`);
    }
    if (step.nextVersion && (semver.prerelease(current) || (published && semver.prerelease(published)))) {
      review('prerelease-channel', `${step.nextVersion} を提案します。プレリリース系列・配布先dist-tagの確認が必要です。`);
    }
  }
  if (pkg.github?.isArchived && step.nextVersion) issue('archived', 'アーカイブ済みrepoの変更・公開は計画できません。');
  if (step.issues.some((entry) => entry.severity === 'blocker')) step.action = 'blocked';
  else if (step.nextVersion || step.dependencyUpdates.length) step.action = isPublishable(pkg) ? 'publish' : 'update-only';
  return step;
}

/** Human-readable preview; JSON output contains the complete machine-readable plan. */
export function formatReleasePlan(plan: ReleasePlan): string {
  const sourceLabels = { none: '変更なし', ahead: '公開版から先行', unknown: '未判定' };
  const lines = [
    `リリース計画: ${plan.target}（${plan.direction === 'downstream' ? '依存元へ伝播・' : ''}計画のみ）`,
    `解析日時: ${plan.snapshot.generatedAt}`,
    `解析SHA-256: ${plan.snapshot.sha256}`,
    `処理順: ${plan.order.join(' → ')}`,
    '',
  ];
  for (const [index, step] of plan.steps.entries()) {
    lines.push(`${index + 1}. ${step.repository} [${step.action}]`,
      `   SHA: ${step.headSha ?? '不明'}`,
      `   ソース変更: ${sourceLabels[step.sourceChanges]}`,
      `   version: ${step.currentVersion ?? 'なし'} → ${step.nextVersion ?? step.currentVersion ?? 'なし'} (${step.versionChange}) / npm: ${step.publishedVersion ?? '未公開・対象外'}`,
      `   理由: ${step.reasons.join(', ') || '計画上の変更なし'}`);
    for (const update of step.dependencyUpdates) {
      lines.push(`   ${update.field}.${update.name}: ${update.from} → ${update.to ?? '要確認'} (対象 ${update.targetVersion}, ${update.source})`);
    }
    for (const entry of step.issues) lines.push(`   ${entry.severity} [${entry.code}]: ${entry.message}`);
  }
  lines.push('', `公開対象: ${plan.publishTargets.length}件`);
  for (const target of plan.publishTargets) lines.push(`  ${target.name}@${target.version} (${target.repository}, ${target.tag})`);
  const warnings = plan.steps.reduce((count, step) => count + step.issues.filter(issue => issue.severity === 'warning').length, 0);
  if (warnings) lines.push(`警告: ${warnings}件。ソース変更が未判定のrepoは、変更なしと確認されたものではありません。`);
  const reviews = plan.steps.flatMap(step => step.issues).filter(issue => issue.requiresReview).length;
  if (reviews) lines.push(`レビュー必要: ${reviews}件。変更先は計画済みですが、ローカル自動適用は停止します。`);
  lines.push(plan.ready ? '計画生成完了。実行時には現状の再確認・検証・承認が必要です。' : '未解決事項があります。公開対象を含む計画全体の実行を保留してください。');
  return lines.join('\n');
}
