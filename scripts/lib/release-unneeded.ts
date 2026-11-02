import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { PackagePlan } from './release-plan.ts';

type DependencyUpdate = PackagePlan['dependencyUpdates'][number];

/** Only a dependency update brought this step into the plan; it has no change of its own. */
export function onlyDependencyUpdate(step: PackagePlan): boolean {
  return step.reasons.length > 0 && step.reasons.every(reason => reason === 'dependency-update');
}

/** Updates that still apply after the named upstream steps were cancelled. Their old ranges stay valid. */
export function effectiveUpdates(step: PackagePlan, cancelled: ReadonlySet<string>): DependencyUpdate[] {
  return step.dependencyUpdates.filter(update => !(update.source === 'planned' && cancelled.has(update.upstreamRepo)));
}

async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else result.push(relative(root, path));
    }
  }
  await walk(root);
  return result.sort();
}

// Consumers never see the version bump or devDependencies, so they do not make a new publication necessary.
function comparableManifest(text: string): string {
  const manifest = JSON.parse(text);
  delete manifest.version;
  delete manifest.devDependencies;
  return JSON.stringify(manifest);
}

/** True when two unpacked npm packages give consumers the same files and the same manifest. */
export async function samePublishedContent(candidate: string, published: string): Promise<boolean> {
  const [left, right] = await Promise.all([files(candidate), files(published)]);
  if (left.length !== right.length || left.some((file, index) => file !== right[index])) return false;
  for (const file of left) {
    const [a, b] = await Promise.all([readFile(join(candidate, file)), readFile(join(published, file))]);
    if (file === 'package.json' ? comparableManifest(a.toString('utf8')) !== comparableManifest(b.toString('utf8')) : !a.equals(b)) return false;
  }
  return true;
}
