import type { PackagePlan } from './release-plan.ts';

type DependencyUpdate = PackagePlan['dependencyUpdates'][number];

/** Only a dependency update brought this step into the plan; it has no change of its own. */
export function onlyDependencyUpdate(step: PackagePlan): boolean {
  return step.reasons.length > 0 && step.reasons.every(reason => reason === 'dependency-update');
}

/** Updates that still apply after the named upstream steps were cancelled. Their old ranges stay valid. */
export function effectiveUpdates(step: PackagePlan, cancelled: ReadonlySet<string>): DependencyUpdate[] {
  return step.dependencyUpdates.filter(update => !(update.source === 'planned' && cancelled.has(update.upstreamRepo)));
}
