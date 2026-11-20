import assert from 'node:assert/strict';
import { test } from 'node:test';
import { provenanceSource } from '../scripts/lib/release-provenance.ts';

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
