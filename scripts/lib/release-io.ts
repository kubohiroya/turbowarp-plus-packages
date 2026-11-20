import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const defaultLockDir = new URL('../../data/release-locks', import.meta.url).pathname;
export async function writeJson(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n'); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
export async function readJson(path: string): Promise<any> { return JSON.parse(await readFile(path, 'utf8')); }

/** A repository lease is shared by workspaces; crashes deliberately leave it for inspection. */
export async function lockRepositories(directory: string, repositories: string[], owner: string) {
  await mkdir(directory, { recursive: true });
  const held: string[] = [];
  try {
    for (const repository of [...new Set(repositories)].sort()) {
      const path = join(directory, hash(repository));
      await mkdir(path).catch(() => { throw new Error(`他の作業が所有しています: ${repository}`); });
      held.push(path);
      await writeJson(join(path, 'owner.json'), { repository, owner, pid: process.pid, startedAt: new Date().toISOString() });
    }
  } catch (error) { for (const path of held) await rm(path, { recursive: true }); throw error; }
  return async () => { for (const path of held) await rm(path, { recursive: true }); };
}
