import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extensionUnsandboxed } from '../scripts/lib/sandbox.ts';

test('reads boolean extension declarations and explicit plugin requirements', () => {
  assert.equal(extensionUnsandboxed('export const extensionConfig = {unsandboxed: true} as const;', null), 'required');
  assert.equal(extensionUnsandboxed('export const extensionConfig = {"unsandboxed": false};', null), 'not-needed');
  for (const status of ['required', 'optional', 'not-needed'] as const) {
    assert.equal(extensionUnsandboxed(null, `turboWarpExtension({unsandboxed: '${status}'})`), status);
  }
  assert.equal(extensionUnsandboxed('const extensionConfig = {unsandboxed: true};',
    "turboWarpExtension({unsandboxed: 'optional'})"), 'optional');
  assert.equal(extensionUnsandboxed('const extensionConfig = {unsandboxed: false};',
    'turboWarpExtension({unsandboxed: extensionConfig.unsandboxed})'), 'not-needed');
});

test('missing or ambiguous declarations never imply sandbox compatibility', () => {
  for (const config of [
    'const extensionConfig = {};',
    'const extensionConfig = {unsandboxed: "false"};',
    'const extensionConfig = {unsandboxed: getRequirement()};',
    'const extensionConfig = {unsandboxed: false, ...other};',
    'const extensionConfig = {unsandboxed: false, [key]: true};',
    'const extensionConfig = {description: "unsandboxed: false"}; // unsandboxed: false',
  ]) assert.equal(extensionUnsandboxed(config, null), 'unknown', config);
  assert.equal(extensionUnsandboxed('const extensionConfig = {unsandboxed: false};',
    'turboWarpExtension({unsandboxed})'), 'unknown');
  assert.equal(extensionUnsandboxed('const extensionConfig = {unsandboxed: false};',
    'turboWarpExtension({...options})'), 'unknown');
  assert.equal(extensionUnsandboxed(null, 'turboWarpExtension({name: "Extension"})'), 'unknown');
});

test('ignores other packages and does not execute repository code', () => {
  assert.equal(extensionUnsandboxed(undefined, undefined), undefined);
  assert.equal(extensionUnsandboxed('const appConfig = {unsandboxed: true};', 'defineConfig({})'), undefined);
  assert.equal(extensionUnsandboxed(null, '// turboWarpExtension({unsandboxed: "required"})'), undefined);
  assert.equal(extensionUnsandboxed('throw new Error("must not run"); const extensionConfig = {unsandboxed: true};', null), 'required');
});
