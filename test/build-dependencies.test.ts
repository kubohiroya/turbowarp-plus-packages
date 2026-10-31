import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fixedEditorBuildDependency } from '../scripts/lib/build-dependencies.ts';

// Verbatim contract files from turbowarp-plus-editor e1149785b900afcb000b94d1a5e0060c9d9ad324.
const [sourceJson, contract, build, packageJson] = await Promise.all(['source.json', 'source.mjs', 'build.mjs', 'package.json'].map((name) => readFile(new URL(`fixtures/fixed-editor/${name}`, import.meta.url), 'utf8')));
const valid = { sourceRevision: 'e1149785b900afcb000b94d1a5e0060c9d9ad324', sourceJson, contract, build, packageJson,
  owner: 'kubohiroya', catalogRepos: ['scratch-gui'] };

test('extracts the real fixed GUI build edge, with pin provenance rather than substituting HEAD', () => {
  const result = fixedEditorBuildDependency(valid);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.dependencies, [{ repo: 'scratch-gui', revision: '338bcb22508f248461d37d05578a17c9bb94d95e',
    sourceRevision: valid.sourceRevision, sourcePath: 'site/source.json', contractPaths: ['scripts/site/source.mjs', 'scripts/site/build.mjs'] }]);
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
