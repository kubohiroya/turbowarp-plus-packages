import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDownstreamReleasePlan } from '../scripts/lib/release-plan.ts';
import type { DashboardPackage, DashboardReport, Dependency } from '../scripts/lib/types.ts';
const a = 'a'.repeat(40), b = 'b'.repeat(40);
const pkg = (repo: string, version: string, dependencies: Dependency[] = []): DashboardPackage => ({
  repo, label: repo, category: 'test', note: null, errors: [],
  manifest: { name: '@test/' + repo, version, private: false, license: 'MIT' },
  npm: { name: '@test/' + repo, published: true, latest: version, versions: [version] },
  revision: { state: 'released', head: { oid: a, committedDate: '2026-11-21T00:00:00Z' },
    tag: { name: 'v' + version, oid: a, committedDate: null }, release: null, aheadBy: 0 }, dependencies,
});
const input = (): DashboardReport => {
  const core = pkg('core', '1.2.0'); core.revision!.state = 'unreleased';
  core.revision!.tag!.oid = b; core.revision!.aheadBy = 1;
  const consumer = pkg('consumer', '4.0.0', [{ name: '@test/core', range: '^1.2.0', kind: 'prod', family: true, local: false, stale: false }]);
  return { generatedAt: '2026-11-21T00:00:00Z', owner: 'test', scope: '@test', site: {}, categories: [], packages: [consumer, core] };
};
test('explicit patch planning propagates one patch per consumer in dependency order', () => {
  const plan = createDownstreamReleasePlan(input(), 'core', { patch: true });
  assert.equal(plan.ready, true); assert.equal(plan.patch, true);
  assert.deepEqual(plan.order, ['core', 'consumer']);
  assert.deepEqual(plan.steps.map(s => s.nextVersion), ['1.2.1', '4.0.1']);
  assert.equal(plan.steps[1].dependencyUpdates[0].to, '^1.2.1');
});
test('the default minor planning policy is unchanged', () => {
  const plan = createDownstreamReleasePlan(input(), 'core');
  assert.equal(plan.patch, undefined); assert.deepEqual(plan.steps.map(s => s.nextVersion), ['1.3.0', '4.1.0']);
});
test('patch selection skips used versions without downgrading or reusing one', () => {
  const report = input(); report.packages[1].npm!.versions!.push('1.2.1');
  assert.equal(createDownstreamReleasePlan(report, 'core', { patch: true }).steps[0].nextVersion, '1.2.2');
});
test('patch selection cannot silently promote a prerelease beyond a newer stable series', () => {
  const report = input(); const core = report.packages[1]; core.manifest!.version = '1.1.0-rc.1';
  const plan = createDownstreamReleasePlan(report, 'core', { patch: true });
  assert.equal(plan.ready, false); assert(plan.steps[0].issues.some(i => i.code === 'prerelease-series'));
});
