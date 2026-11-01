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
