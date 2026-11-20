import assert from 'node:assert/strict';
import { test } from 'node:test';
import { provenanceSource } from '../scripts/lib/release-provenance.ts';
import { GithubNpmReleaseDriver } from '../scripts/lib/release-driver.ts';
import type { PackagePlan } from '../scripts/lib/release-plan.ts';
import type { ReleaseProfile } from '../scripts/lib/release-execution.ts';

const source = 'a'.repeat(40);
const statement = () => ({ _type: 'https://in-toto.io/Statement/v1', predicateType: 'https://slsa.dev/provenance/v1',
  subject: [{ name: 'pkg:npm/%40family/tool@1.0.0', digest: { sha512: Buffer.from('archive').toString('hex') } }],
  predicate: { buildDefinition: { externalParameters: { workflow: { repository: 'https://github.com/family/tool',
    ref: 'refs/tags/v1.0.0', path: '.github/workflows/release.yml' } }, resolvedDependencies: [
      { uri: 'git+https://github.com/family/tool@refs/tags/v1.0.0', digest: { gitCommit: source } } ] },
    runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' } } } });
const envelope = (s: unknown) => ({ attestations: [{ predicateType: 'https://slsa.dev/provenance/v1',
  bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(s)).toString('base64') } } }] });
const check = (s: unknown) => provenanceSource('@family/tool', '1.0.0', 'sha512-' + Buffer.from('archive').toString('base64'), 'family/tool', envelope(s));

test('provenance binds source to the package identity, archive digest, repository and workflow', () => {
  assert.equal(check(statement()), source);
  const wrongDigest = statement(); wrongDigest.subject[0].digest.sha512 = '00';
  assert.equal(check(wrongDigest), null);
  const wrongRepo = statement(); wrongRepo.predicate.buildDefinition.externalParameters.workflow.repository = 'https://github.com/other/tool';
  assert.equal(check(wrongRepo), null);
  const wrongWorkflow = statement(); wrongWorkflow.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/other.yml';
  assert.equal(check(wrongWorkflow), null);
  const wrongName = statement(); wrongName.subject[0].name = 'pkg:npm/other@1.0.0';
  assert.equal(check(wrongName), null);
});

test('malformed and conflicting statements cannot establish the source', () => {
  assert.equal(check(null), null);
  const conflict = statement();
  conflict.predicate.buildDefinition.resolvedDependencies.push({ uri: 'git+https://github.com/family/tool@refs/tags/v1.0.0', digest: { gitCommit: 'b'.repeat(40) } });
  assert.equal(check(conflict), null);
});

for (const scenario of ['stale-githead', 'wrong-source', 'wrong-digest'] as const) {
  test(`registry provenance remains authoritative with a manifest gitHead (${scenario})`, async t => {
    const attestation = statement();
    if (scenario === 'wrong-source') attestation.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'b'.repeat(40);
    if (scenario === 'wrong-digest') attestation.subject[0].digest.sha512 = '00';
    let fetched = 0;
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      assert.equal(url, 'https://registry.npmjs.org/-/npm/v1/attestations/%40family%2Ftool@1.0.0');
      fetched++;
      return new Response(JSON.stringify(envelope(attestation)), {status: 200});
    });
    const step: PackagePlan = {repo: 'tool', repository: 'family/tool', name: '@family/tool', headSha: source,
      currentVersion: '0.9.0', publishedVersion: '0.9.0', nextVersion: '1.0.0', versionChange: 'prepared',
      sourceChanges: 'ahead', action: 'publish', reasons: [], dependencyUpdates: [], issues: []};
    const profile: ReleaseProfile = {install: [['fixture-install']], verify: [['fixture-verify']],
      publish: {mode: 'cli', provenance: true}};
    const entry = {phase: 'released' as const, commit: source};
    const driver = new GithubNpmReleaseDriver('/tmp/unused-provenance-test', {schemaVersion: 1, repositories: {}},
      {schemaVersion: 1, digest: 'c'.repeat(64), entries: {tool: entry}}, async () => {}, async command => {
        assert.equal(command[0], 'npm'); assert.equal(command[1], 'view');
        return JSON.stringify({name: step.name, version: step.nextVersion,
          gitHead: scenario === 'stale-githead' ? 'b'.repeat(40) : source,
          dist: {integrity: 'sha512-' + Buffer.from('archive').toString('base64'),
            attestations: {provenance: {predicateType: 'https://slsa.dev/provenance/v1'}}}});
      });
    if (scenario === 'stale-githead') await driver.published(step, profile, entry);
    else await assert.rejects(driver.published(step, profile, entry), scenario === 'wrong-digest' ? /provenance/ : /公開済み版/);
    assert(fetched > 0);
  });
}
