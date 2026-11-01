import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEditorCatalog, type CatalogState } from './lib/extension-catalog.ts';
import { errorMessage } from './lib/errors.ts';
import type { DashboardReport } from './lib/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const statePath = join(root, 'data/extension-catalog-state.json');

/**
 * What the previous run published, so a package that cannot be read right now
 * keeps its last known-good entry. CI restores this from the Actions cache the
 * same way it restores thumbnail snapshots. A first run, an evicted cache or a
 * file we cannot make sense of simply leaves no fallback, which is the old
 * behaviour: one unreadable package fails the build.
 */
async function previousState(): Promise<CatalogState | undefined> {
  let text;
  try {
    text = await readFile(statePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const state = JSON.parse(text) as CatalogState;
    if (state?.schemaVersion !== 1) throw new Error(`unsupported schemaVersion ${state?.schemaVersion}`);
    if (!Array.isArray(state.published)) throw new Error('no published records');
    return {...state, failures: state.failures ?? {}};
  } catch (error) {
    console.warn(`ignoring ${statePath}: ${errorMessage(error)}`);
    return undefined;
  }
}

const report: DashboardReport = JSON.parse(await readFile(join(root, 'data/dashboard.json'), 'utf8'));
const { catalog, state, carriedOver } = await collectEditorCatalog(report, {
  allowPrerelease: process.env.TW_PLUS_EDITOR_CATALOG_PRERELEASE === '1',
  previous: await previousState(),
});
await mkdir(join(root, 'site'), {recursive: true});
await writeFile(join(root, 'site/extensions-v1.json'), `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
console.log(`wrote site/extensions-v1.json (${catalog.extensions.length} extensions)`);
for (const { package: name, attempts, error } of carriedOver) {
  const runs = attempts === 1 ? 'one failed run' : `${attempts} failed runs in a row`;
  console.warn(`  carried over ${name} from the previous run after ${runs}: ${error}`);
}
