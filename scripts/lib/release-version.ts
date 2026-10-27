import semver from 'semver';

/** Preserve the prerelease identifier; arbitrary coercible tag fragments are not releases. */
export function releaseVersionsMatch(npmVersion: string | null | undefined, tag: string | null | undefined): boolean | null {
  const published = semver.valid(npmVersion);
  const tagged = semver.valid(tag);
  return published && tagged ? semver.eq(published, tagged) : null;
}
