import type { NpmStatus } from './types.ts';

interface Packument {
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, { deprecated?: string }>;
  modified?: string;
}

const REGISTRY = process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org';

/**
 * The abbreviated packument is a fraction of the size of the full one and
 * carries everything the dashboard needs: dist-tags, the version list, each
 * version's deprecation notice, and `modified` (the last publish).
 */
const ABBREVIATED = 'application/vnd.npm.install-v1+json';

const cache = new Map<string, Promise<Packument | null>>();

export function packument(name: string): Promise<Packument | null> {
  if (!cache.has(name)) cache.set(name, fetchPackument(name));
  return cache.get(name)!;
}

async function fetchPackument(name: string, retries = 2): Promise<Packument | null> {
  const url = `${REGISTRY}/${name.replace('/', '%2f')}`;
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        headers: { accept: ABBREVIATED, 'user-agent': 'turbowarp-plus-packages' },
      });
    } catch (cause) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      throw new Error(`npm registry unreachable for ${name}`, { cause });
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      throw new Error(`npm registry ${response.status} for ${name}`);
    }
    return response.json();
  }
}

/** The published state of one of our own packages. */
export async function packageStatus(name: string): Promise<NpmStatus> {
  const doc = await packument(name);
  if (!doc) return { name, published: false };

  const latest = doc['dist-tags']?.latest ?? null;
  const versions = Object.keys(doc.versions ?? {});
  return {
    name,
    published: true,
    latest,
    // `modified` is the registry's last-write time. For these packages that is
    // the publish time of the newest version, which is what we want to show.
    lastPublishedAt: doc.modified ?? null,
    versionCount: versions.length,
    versions,
    deprecated: latest ? (doc.versions?.[latest]?.deprecated ?? null) : null,
    distTags: doc['dist-tags'] ?? {},
  };
}

/** Just the latest version, for resolving a dependency range. */
export async function latestVersion(name: string): Promise<string | null> {
  const doc = await packument(name);
  return doc?.['dist-tags']?.latest ?? null;
}

/** Every published version, for working out what a range actually resolves to. */
export async function allVersions(name: string): Promise<string[] | null> {
  const doc = await packument(name);
  return doc ? Object.keys(doc.versions ?? {}) : null;
}
