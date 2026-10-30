import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEditorCatalog } from './lib/extension-catalog.ts';
import type { DashboardReport } from './lib/types.ts';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const report: DashboardReport = JSON.parse(await readFile(join(root, 'data/dashboard.json'), 'utf8'));
const catalog = await collectEditorCatalog(report, {
  allowPrerelease: process.env.TW_PLUS_EDITOR_CATALOG_PRERELEASE === '1',
});
await mkdir(join(root, 'site'), {recursive: true});
await writeFile(join(root, 'site/extensions-v1.json'), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`wrote site/extensions-v1.json (${catalog.extensions.length} extensions)`);
