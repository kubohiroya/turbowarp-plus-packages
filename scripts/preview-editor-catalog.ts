import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {catalogEntryPresentation, type EditorCatalog} from './lib/extension-catalog.ts';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: node --import tsx scripts/preview-editor-catalog.ts <catalog-snapshot.json>');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog: EditorCatalog = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.extensions)) throw new Error('Expected a v1 catalog snapshot');
// A recorded snapshot keeps the code versions, URLs and dependency graph unchanged.
const result = {...catalog, extensions: catalog.extensions.map(catalogEntryPresentation)};
await mkdir(join(root, 'site'), {recursive: true});
await writeFile(join(root, 'site/extensions-v1.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`wrote presentation preview (${result.extensions.length} extensions; no network requests)`);
