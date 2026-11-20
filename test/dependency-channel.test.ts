import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateRange } from '../scripts/lib/dependencies.ts';

test('a newer selected vendor release is not offered an older stable downgrade', () => {
  const result = evaluateRange({ range: '4.12.0-release.1', versions: ['4.5.2', '4.12.0-release.1'] });
  assert.equal(result.latest, '4.12.0-release.1'); assert.equal(result.stale, false);
  assert.equal(result.behind, null);
});

test('a later stable release still identifies the older vendor release as outdated', () => {
  const result = evaluateRange({ range: '4.12.0-release.1', versions: ['4.5.2', '4.12.0-release.1', '4.13.0'] });
  assert.equal(result.latest, '4.13.0'); assert.equal(result.stale, true);
});
