import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const DEFAULT_LOCAL_PROTOCOLS = ['file:', 'link:', 'workspace:', 'portal:', 'patch:'];

/**
 * Reads catalog.yaml and flattens it into the list of entries the collector
 * walks. The catalog is the only hand-maintained input: everything else is
 * derived from the GitHub and npm APIs.
 */
export async function loadCatalog(path = 'catalog.yaml') {
  const raw = parse(await readFile(path, 'utf8'));

  if (!raw?.owner) throw new Error(`${path}: "owner" is required`);
  if (!Array.isArray(raw.categories)) throw new Error(`${path}: "categories" must be a list`);

  const scope = raw.scope ?? `@${raw.owner}`;
  const overrides = raw.overrides ?? {};
  const entries = [];
  const seen = new Map();

  for (const category of raw.categories) {
    if (!category.id) throw new Error(`${path}: every category needs an "id"`);
    for (const repo of category.packages ?? []) {
      if (seen.has(repo)) {
        throw new Error(`${path}: "${repo}" is listed in both "${seen.get(repo)}" and "${category.id}"`);
      }
      seen.set(repo, category.id);

      const override = overrides[repo] ?? {};
      entries.push({
        repo,
        category: category.id,
        npm: override.npm === false ? null : (override.npm ?? `${scope}/${repo}`),
        note: override.note ?? null,
        label: override.label ?? repo,
        // Summaries are read from the repository's own READMEs; these only
        // exist for the cases where that text does not suit a table cell.
        description: override.description ?? null,
        descriptionJa: override.descriptionJa ?? null,
      });
    }
  }

  for (const repo of Object.keys(overrides)) {
    if (!seen.has(repo)) {
      throw new Error(`${path}: override for "${repo}" does not match any listed package`);
    }
  }

  return {
    owner: raw.owner,
    scope,
    site: raw.site ?? {},
    localProtocols: raw.localProtocols ?? DEFAULT_LOCAL_PROTOCOLS,
    categories: raw.categories.map(({ id, title, titleJa, description, descriptionJa }) => ({
      id,
      title,
      titleJa: titleJa ?? null,
      description: description ?? null,
      descriptionJa: descriptionJa ?? null,
    })),
    entries,
    /** npm package name -> repo name, for spotting in-family dependencies. */
    npmToRepo: new Map(entries.filter((e) => e.npm).map((e) => [e.npm, e.repo])),
  };
}
