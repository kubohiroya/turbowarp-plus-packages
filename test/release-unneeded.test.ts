import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveUpdates, onlyDependencyUpdate } from '../scripts/lib/release-unneeded.ts';
import { fixture } from './release-execution.test.ts';

test('only steps brought in by a dependency update can be cancelled, and cancelled upstream updates are dropped', () => {
  const [upstream, downstream] = fixture().plan.steps;
  assert.equal(onlyDependencyUpdate(upstream), false);
  assert.equal(onlyDependencyUpdate({ ...downstream, reasons: ['dependency-update'] }), true);
  assert.equal(onlyDependencyUpdate({ ...downstream, reasons: ['dependency-update', 'commits-ahead'] }), false);
  assert.equal(effectiveUpdates(downstream, new Set()).length, 1);
  assert.deepEqual(effectiveUpdates(downstream, new Set(['upstream'])), []);
  const published = { ...downstream.dependencyUpdates[0], source: 'published' as const };
  assert.equal(effectiveUpdates({ ...downstream, dependencyUpdates: [published] }, new Set(['upstream'])).length, 1);
});
