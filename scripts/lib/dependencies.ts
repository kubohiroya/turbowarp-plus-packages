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
  let latest =
    semver.maxSatisfying(stable.length ? stable : versions, '*', { includePrerelease: true }) ?? null;
  const wanted = semver.maxSatisfying(versions, range, { loose: true }) ?? null;

  // Some vendors use a prerelease-shaped name for newer production artifacts.
  // Never call a selected newer version stale relative to an older stable release.
  if (latest && wanted && semver.gt(wanted, latest)) latest = wanted;

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

/** package.json files below the repository root that are part of the repository's own source. */
export function nestedManifestPaths(paths: readonly string[]): string[] {
  return paths.filter((path) => path.endsWith('/package.json') &&
    !/(^|\/)(node_modules|fixtures?|test|tests|__fixtures__)\//u.test(path));
}

/**
 * Family dependencies declared outside the root package.json.
 *
 * The release plan reads only the root manifest, so a family version pinned in a nested
 * manifest is never updated by a dependency release and silently stays old. Each one is
 * reported, so it is moved to the root instead of being missed.
 */
export function nestedFamilyDependencies(
  manifests: readonly { path: string; text: string }[],
  isFamily: (name: string) => boolean,
): string[] {
  const problems: string[] = [];
  for (const { path, text } of manifests) {
    let manifest: PackageManifest;
    try { manifest = JSON.parse(text); } catch { problems.push(`${path}: package.json is not valid JSON`); continue; }
    const names = declaredDependencies(manifest, isFamily).filter((entry) => entry.family)
      .map((entry) => `${entry.name}@${entry.range}`);
    if (names.length) problems.push(`${path}: family dependencies outside the root package.json are not updated by dependency releases; declare them at the root: ${names.join(', ')}`);
  }
  return problems;
}
