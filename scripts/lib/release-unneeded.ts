import semver from 'semver';
import type { PackagePlan } from './release-plan.ts';

type DependencyUpdate = PackagePlan['dependencyUpdates'][number];

/** Only a dependency update brought this step into the plan; it has no change of its own. */
export function onlyDependencyUpdate(step: PackagePlan): boolean {
  return step.reasons.length > 0 && step.reasons.every(reason => reason === 'dependency-update');
}

/**
 * The updates that still apply once some upstream steps were cancelled.
 *
 * `cancelled` maps each cancelled repository to the version it keeps serving (its published version), or
 * to `undefined` when that is unknown. An update that aimed at the cancelled release is aimed at that
 * version instead: the dependent may still pin something older than what is already published, and it
 * should not be left behind just because the newest release turned out to be unnecessary. It is dropped
 * only when the current specification already reaches that version, when the version is unknown, or when
 * the specification is not a plain exact, caret or tilde version.
 */
export function effectiveUpdates(step: PackagePlan, cancelled: ReadonlyMap<string, string | undefined>): DependencyUpdate[] {
  const updates: DependencyUpdate[] = [];
  for (const update of step.dependencyUpdates) {
    if (update.source !== 'planned' || !cancelled.has(update.upstreamRepo)) {
      updates.push(update);
      continue;
    }
    const kept = cancelled.get(update.upstreamRepo);
    const match = /^(\^|~)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u.exec(update.from.trim());
    if (!kept || !semver.valid(kept) || !match || !semver.valid(match[2]) || semver.gte(match[2], kept)) continue;
    updates.push({ ...update, to: `${match[1] ?? ''}${kept}`, targetVersion: kept, source: 'published' });
  }
  return updates;
}
