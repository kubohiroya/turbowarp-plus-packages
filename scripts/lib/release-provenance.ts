import { Buffer } from 'node:buffer';

/** Read the registry's provenance statement, binding its source to the registry's package digest. */
export function provenanceSource(name: string, version: string, integrity: string, repository: string, attestations: any): string | null {
  const expected = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity);
  if (!expected) return null;
  const digest = Buffer.from(expected[1], 'base64').toString('hex');
  const commits = new Set<string>();
  for (const a of attestations?.attestations ?? []) {
    if (a.predicateType !== 'https://slsa.dev/provenance/v1') continue;
    try {
      const s = JSON.parse(Buffer.from(a.bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
      const definition = s.predicate.buildDefinition;
      const workflow = definition.externalParameters.workflow;
      const url = `https://github.com/${repository}`;
      const purl = `pkg:npm/${encodeURIComponent(name).replace('%2F', '/')}@${version}`;
      if (s._type !== 'https://in-toto.io/Statement/v1' || s.predicateType !== a.predicateType ||
          !s.subject.some((v: any) => v.name === purl && v.digest.sha512 === digest) ||
          workflow.repository !== url || workflow.path !== '.github/workflows/release.yml' ||
          s.predicate.runDetails.builder.id !== 'https://github.com/actions/runner/github-hosted') continue;
      const deps = definition.resolvedDependencies.filter((v: any) =>
        v.uri === `git+${url}@${workflow.ref}` && /^[a-f0-9]{40}$/.test(v.digest.gitCommit));
      for (const dep of deps) commits.add(dep.digest.gitCommit);
    } catch { /* Malformed statements do not establish a release source. */ }
  }
  return commits.size === 1 ? [...commits][0] : null;
}
