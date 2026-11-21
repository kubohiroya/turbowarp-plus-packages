import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadCatalog } from '../scripts/lib/catalog.ts';

/** Writes one catalog file and returns its path. */
async function catalog(yaml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-'));
  const path = join(dir, 'catalog.yaml');
  await writeFile(path, yaml);
  return path;
}

const BASE = `
owner: example
categories:
  - id: foundation
    title: Editor
    packages:
      - shown-site
      - hidden-site
`;

test('pages defaults to on and only "false" turns a Pages site off', async () => {
  const entries = (await loadCatalog(await catalog(`${BASE}
overrides:
  hidden-site:
    pages: false
`))).entries;
  assert.equal(entries.find((entry) => entry.repo === 'shown-site')?.pages, true);
  assert.equal(entries.find((entry) => entry.repo === 'hidden-site')?.pages, false);
});

test('a "pages" override other than false is a catalog error', async () => {
  await assert.rejects(
    loadCatalog(await catalog(`${BASE}
overrides:
  hidden-site:
    pages: true
`)),
    /"pages" for "hidden-site" may only be false/,
  );
});

test('an Editor catalog hold carries its reason and must give one', async () => {
  const entries = (await loadCatalog(await catalog(`${BASE}
overrides:
  hidden-site:
    editorCatalogHold: '  not ready for the Editor yet  '
`))).entries;
  assert.equal(entries.find((entry) => entry.repo === 'hidden-site')?.editorCatalogHold, 'not ready for the Editor yet');
  assert.equal(entries.find((entry) => entry.repo === 'shown-site')?.editorCatalogHold, undefined);
  await assert.rejects(
    loadCatalog(await catalog(`${BASE}
overrides:
  hidden-site:
    editorCatalogHold: ' '
`)),
    /"editorCatalogHold" for "hidden-site" must say why it is held/,
  );
});

test('application identity is independent of display category and must be explicit', async () => {
  const entries = (await loadCatalog(await catalog(`${BASE}
overrides:
  shown-site:
    application: true
`))).entries;
  assert.equal(entries.find(entry => entry.repo === 'shown-site')?.application, true);
  assert.equal(entries.find(entry => entry.repo === 'hidden-site')?.application, undefined);
  await assert.rejects(loadCatalog(await catalog(`${BASE}
overrides:
  shown-site:
    application: 'true'
`)), /"application" for "shown-site" may only be true/);
});

test('dashboard roles preserve dependency categories and reject unknown roles', async () => {
  const result = await loadCatalog(await catalog(`${BASE}
overrides:
  shown-site:
    dashboardGroup: extensions
  hidden-site:
    dashboardGroup: infrastructure
`));
  assert.deepEqual(result.entries.map(({category, dashboardGroup}) => ({category, dashboardGroup})), [
    {category: 'foundation', dashboardGroup: 'extensions'},
    {category: 'foundation', dashboardGroup: 'infrastructure'},
  ]);
  for (const value of ['other', 'true', 'false', 'null', '42', '[]']) {
    await assert.rejects(loadCatalog(await catalog(`${BASE}
overrides:
  shown-site:
    dashboardGroup: ${value}
`)), /"dashboardGroup" for "shown-site" must be extensions or infrastructure/);
  }
});

test('a release hold carries its reason and must give one', async () => {
  const entries = (await loadCatalog(await catalog(`${BASE}
overrides:
  hidden-site:
    releaseHold: '  its owner cuts each version  '
`))).entries;
  assert.equal(entries.find((entry) => entry.repo === 'hidden-site')?.releaseHold, 'its owner cuts each version');
  assert.equal(entries.find((entry) => entry.repo === 'shown-site')?.releaseHold, undefined);
  await assert.rejects(
    loadCatalog(await catalog(`${BASE}
overrides:
  hidden-site:
    releaseHold: ' '
`)),
    /"releaseHold" for "hidden-site" must say why it is held/,
  );
});
