import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fixedEditorBuildDependency } from '../scripts/lib/build-dependencies.ts';

// Verbatim contract files from turbowarp-plus-editor d75e6163b12d78717b90630950d0df6a53c7ce5d.
const [sourceJson, contract, build, packageJson] = await Promise.all(['source.json', 'source.ts', 'build.ts', 'package.json'].map((name) => readFile(new URL(`fixtures/fixed-editor/${name}`, import.meta.url), 'utf8')));
const valid = { sourceRevision: 'd75e6163b12d78717b90630950d0df6a53c7ce5d', sourceJson, contract, build, packageJson,
  owner: 'kubohiroya', catalogRepos: ['scratch-gui'] };

test('extracts the real fixed GUI build edge, with pin provenance rather than substituting HEAD', () => {
  const result = fixedEditorBuildDependency(valid);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.dependencies, [{ repo: 'scratch-gui', revision: '2068ed59aaf0d67f699bb1d1a74975fc3819a9dc',
    sourceRevision: valid.sourceRevision, sourcePath: 'site/source.json', contractPaths: ['scripts/site/source.ts', 'scripts/site/build.ts'] }]);
});

test('missing or malformed metadata fails visibly without inventing an edge', () => {
  for (const patch of [{ sourceJson: null }, { contract: null }, { build: null }, { sourceRevision: null }, { packageJson: null },
    { sourceJson: 'invalid JSON' }, { sourceJson: JSON.stringify({ guiRepository: 'kubohiroya/scratch-gui', guiRevision: 'develop' }) }]) {
    const result = fixedEditorBuildDependency({ ...valid, ...patch });
    assert.deepEqual(result.dependencies, []);
    assert.ok(result.error);
  }
});

test('unknown targets and unsupported contracts do not fall back to a guessed GUI dependency', () => {
  for (const patch of [{ catalogRepos: [] }, { owner: 'someone-else' }, { packageJson: '{"scripts":{"build:pages":"something-else"}}' }, { contract: contract.replaceAll('pins.guiRevision', 'pins.otherRevision') },
    { build: build.replace('await verifyHost(gui, pins)', 'await unknownHost(gui, pins)') },
    { contract: '/* ' + contract + ' */' }, { build: build + '\nconst =' },
    { contract: contract.replace("execFileSync('git', ['rev-parse', 'HEAD'], {cwd: gui, encoding: 'utf8'}).trim()", "'not-the-GUI-HEAD'") }]) {
    const result = fixedEditorBuildDependency({ ...valid, ...patch });
    assert.deepEqual(result.dependencies, []);
    assert.ok(result.error);
  }
});

// Verbatim contract files from turbowarp-plus-editor 7a0fc70f85c01ad1db5fc8699f287a6766df8d91 (#744):
// `readPins` reads `site/source.json` through `readPinsSync` in `locked-pins.cts`.
const lockedFixture = await Promise.all(['source.json', 'source.ts', 'build.ts', 'package.json', 'locked-pins.cts'].map((name) => readFile(new URL(`fixtures/fixed-editor-744/${name}`, import.meta.url), 'utf8')));
const lockedValid = { sourceRevision: '7a0fc70f85c01ad1db5fc8699f287a6766df8d91', sourceJson: lockedFixture[0], contract: lockedFixture[1],
  build: lockedFixture[2], packageJson: lockedFixture[3], lockedPins: lockedFixture[4], owner: 'kubohiroya', catalogRepos: ['scratch-gui'] };

test('reads the GUI pin through locked-pins.cts after the npm pins moved to the lockfile', () => {
  const result = fixedEditorBuildDependency(lockedValid);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.dependencies, [{ repo: 'scratch-gui', revision: 'b2e75a129546db48e6563f72c80a3d3d46d86fb5',
    sourceRevision: lockedValid.sourceRevision, sourcePath: 'site/source.json', contractPaths: ['scripts/site/source.ts', 'scripts/site/build.ts'] }]);
});

test('readPinsSync must still read site/source.json from the repository root', () => {
  for (const patch of [{ lockedPins: null }, { lockedPins: lockedValid.lockedPins.replace("path.join(root, 'site/source.json')", "path.join(root, 'site/other.json')") },
    { lockedPins: lockedValid.lockedPins.replace('function readPinsSync', 'function readOtherPins') }]) {
    const result = fixedEditorBuildDependency({ ...lockedValid, ...patch });
    assert.deepEqual(result.dependencies, []);
    assert.ok(result.error);
  }
});
