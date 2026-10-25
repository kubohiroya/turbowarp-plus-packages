import semver from 'semver';
import type { DeclaredDependency, PackageManifest, RangeVerdict } from './types.ts';

export const DEPENDENCY_KINDS = {
  dependencies: 'prod',
  peerDependencies: 'peer',
  optionalDependencies: 'optional',
  devDependencies: 'dev',
} as const;

const UNRESOLVABLE = /^(git(\+|:)|github:|npm:|https?:|file$)/;

/**
 * A range that points somewhere on this machine rather than at the registry.
 * These are fine while developing and wrong once published, so they get a 💀.
 */
export function isLocalRange(range: string | null | undefined, localProtocols: readonly string[]) {
  if (!range) return false;
  if (localProtocols.some((protocol) => range.startsWith(protocol))) return true;
  return range.startsWith('./') || range.startsWith('../') || range.startsWith('/');
}

/**
 * Decides what to say about one declared range, given every version the
 * registry has for that package.
 *
 * `versions` is null when the package is not on the registry at all.
 * Returns { local, stale, unresolvable, missing, latest, wanted, behind }.
 */
export function evaluateRange({ range, versions, localProtocols = [] }: {
  range: string;
  versions: string[] | null;
  localProtocols?: readonly string[];
}): RangeVerdict {
  if (isLocalRange(range, localProtocols)) {
    return { local: true, stale: false };
  }

  if (UNRESOLVABLE.test(range) || !semver.validRange(range, { loose: true })) {
    return { local: false, stale: false, unresolvable: true };
  }

  if (!versions) {
    return { local: false, stale: false, missing: true };
  }

  const stable = versions.filter((v) => !semver.prerelease(v));
  const latest =
    semver.maxSatisfying(stable.length ? stable : versions, '*', { includePrerelease: true }) ?? null;
  const wanted = semver.maxSatisfying(versions, range, { loose: true }) ?? null;

  if (!latest) return { local: false, stale: false, missing: true };

  const stale = !semver.satisfies(latest, range, { loose: true });
  return {
    local: false,
    stale,
    latest,
    wanted,
    behind: stale && wanted ? semver.diff(wanted, latest) : null,
  };
}

/**
 * Picks the dependencies worth showing out of a package.json.
 *
 * Dev dependencies only make the list when they are one of our own packages:
 * that is how the build tooling shows up as an upstream of every extension,
 * without dragging in every linter and test runner.
 */
export function declaredDependencies(
  manifest: PackageManifest | null,
  isFamily: (name: string) => boolean,
): DeclaredDependency[] {
  const declared: DeclaredDependency[] = [];
  for (const field of Object.keys(DEPENDENCY_KINDS) as (keyof typeof DEPENDENCY_KINDS)[]) {
    const kind = DEPENDENCY_KINDS[field];
    for (const [name, range] of Object.entries(manifest?.[field] ?? {})) {
      const family = isFamily(name);
      if (kind === 'dev' && !family) continue;
      declared.push({ name, range, kind, family });
    }
  }
  return declared;
}
