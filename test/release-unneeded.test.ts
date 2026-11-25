import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveUpdates, onlyDependencyUpdate } from '../scripts/lib/release-unneeded.ts';
import { fixture } from './release-execution.test.ts';

test('only steps brought in by a dependency update can be cancelled, and cancelled upstream updates are dropped', () => {
  const [upstream, downstream] = fixture().plan.steps;
  assert.equal(onlyDependencyUpdate(upstream), false);
  assert.equal(onlyDependencyUpdate({ ...downstream, reasons: ['dependency-update'] }), true);
  assert.equal(onlyDependencyUpdate({ ...downstream, reasons: ['dependency-update', 'commits-ahead'] }), false);
  assert.equal(effectiveUpdates(downstream, new Map()).length, 1);
  // The fixture's range ^1.0.0 already reaches the kept 1.0.0, or the kept version is unknown.
  assert.deepEqual(effectiveUpdates(downstream, new Map([['upstream', '1.0.0']])), []);
  assert.deepEqual(effectiveUpdates(downstream, new Map([['upstream', undefined]])), []);
  const published = { ...downstream.dependencyUpdates[0], source: 'published' as const };
  assert.equal(effectiveUpdates({ ...downstream, dependencyUpdates: [published] }, new Map([['upstream', '1.0.0']])).length, 1);
});

test('an update aimed at a cancelled release is aimed at the version the upstream keeps serving', () => {
  const [, downstream] = fixture().plan.steps;
  const planned = (from: string, to: string) => ({ ...downstream, dependencyUpdates: [{ ...downstream.dependencyUpdates[0], from, to, targetVersion: to.replace(/^[\^~]/u, '') }] });
  // An exact pin two releases behind: the cancelled 0.8.3 would have replaced 0.8.1, so 0.8.2 does.
  assert.deepEqual(effectiveUpdates(planned('0.8.1', '0.8.3'), new Map([['upstream', '0.8.2']])).map(u => [u.from, u.to, u.targetVersion, u.source]),
    [['0.8.1', '0.8.2', '0.8.2', 'published']]);
  assert.deepEqual(effectiveUpdates(planned('^0.13.1', '^0.13.3'), new Map([['upstream', '0.13.2']])).map(u => u.to), ['^0.13.2']);
  assert.deepEqual(effectiveUpdates(planned('~1.2.0', '~1.2.2'), new Map([['upstream', '1.2.1']])).map(u => u.to), ['~1.2.1']);
  // Already at the kept version, or a range that is not a plain version: nothing to do.
  assert.deepEqual(effectiveUpdates(planned('0.8.2', '0.8.3'), new Map([['upstream', '0.8.2']])), []);
  assert.deepEqual(effectiveUpdates(planned('>=0.8.0 <0.9.0', '>=0.8.0 <0.9.0 || 0.8.3'), new Map([['upstream', '0.8.2']])), []);
});
