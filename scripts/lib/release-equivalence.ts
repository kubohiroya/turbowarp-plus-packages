import { isDeepStrictEqual } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/**
 * Whether a release candidate would publish what the registry already serves.
 *
 * A step that only follows a dependency update is often rebuilt into the same artifact: the family's
 * bundles embed their own version and the pnpm store path of each bundled dependency, and nothing else
 * changes. Publishing such a version gives users nothing, and every dependent then follows it, so the
 * executor cancels the step instead. These rules decide what "the same" means.
 *
 * - `package.json`: compared as data without `version`, `devDependencies` and `gitHead`. A changed
 *   `dependencies`, `peerDependencies` or `optionalDependencies` range is a difference, because it
 *   changes what users install.
 * - Markdown anywhere and everything under `docs/` is documentation the release itself rewrites
 *   (version pins, changelog sections, companion versions), so it is not compared.
 * - Other text files are compared after naming the package's own version and the pnpm store path the
 *   same way in both: `node_modules/.pnpm/<name>@<version>.../node_modules/` becomes `node_modules/`.
 * - Binary files are compared byte for byte.
 */
export async function artifactDifferences(
  publishedRoot: string, candidateRoot: string, versions: { published: string; candidate: string },
): Promise<string[]> {
  const [before, after] = await Promise.all([files(publishedRoot), files(candidateRoot)]);
  const differences: string[] = [];
  for (const path of [...new Set([...before, ...after])].sort()) {
    if (isDocumentation(path)) continue;
    if (!before.includes(path)) { differences.push(`added ${path}`); continue; }
    if (!after.includes(path)) { differences.push(`removed ${path}`); continue; }
    const [old, next] = await Promise.all([readFile(join(publishedRoot, path)), readFile(join(candidateRoot, path))]);
    if (path === 'package.json') {
      if (!isDeepStrictEqual(manifest(old), manifest(next))) differences.push(`changed ${path}`);
    } else if (isText(old) && isText(next)) {
      if (normalise(old.toString('utf8'), versions.published) !== normalise(next.toString('utf8'), versions.candidate)) {
        differences.push(`changed ${path}`);
      }
    } else if (!old.equals(next)) differences.push(`changed ${path}`);
  }
  return differences;
}

const VERSION = '\u0000version\u0000';
const STORE_PATH = /node_modules\/\.pnpm\/[^/\s"'`]+\/node_modules\//gu;

function normalise(text: string, version: string): string {
  return text.split(version).join(VERSION).replace(STORE_PATH, 'node_modules/');
}

function manifest(bytes: Buffer): unknown {
  const { version: _version, devDependencies: _dev, gitHead: _gitHead, ...rest } = JSON.parse(bytes.toString('utf8'));
  return rest;
}

const isDocumentation = (path: string) => /\.(md|markdown)$/iu.test(path) || path.startsWith('docs/');
/** A NUL byte in the first 8 KiB marks a binary file, as Git decides. */
const isText = (bytes: Buffer) => !bytes.subarray(0, 8192).includes(0);

async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'));
}
