import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { Catalog, CatalogEntry, RawCatalog } from './types.ts';

const DEFAULT_LOCAL_PROTOCOLS = ['file:', 'link:', 'workspace:', 'portal:', 'patch:'];

/**
 * Reads catalog.yaml and flattens it into the list of entries the collector
 * walks. The catalog is the only hand-maintained input: everything else is
 * derived from the GitHub and npm APIs.
 */
export async function loadCatalog(path = 'catalog.yaml'): Promise<Catalog> {
  const raw = parse(await readFile(path, 'utf8')) as RawCatalog;

  if (!raw?.owner) throw new Error(`${path}: "owner" is required`);
  if (!Array.isArray(raw.categories)) throw new Error(`${path}: "categories" must be a list`);

  const scope = raw.scope ?? `@${raw.owner}`;
  const overrides = raw.overrides ?? {};
  const entries: CatalogEntry[] = [];
  const seen = new Map<string, string>();

  for (const category of raw.categories) {
    if (!category.id) throw new Error(`${path}: every category needs an "id"`);
    for (const repo of category.packages ?? []) {
      if (seen.has(repo)) {
        throw new Error(`${path}: "${repo}" is listed in both "${seen.get(repo)}" and "${category.id}"`);
      }
      seen.set(repo, category.id);

      const override = overrides[repo] ?? {};
      if (override.dashboardGroup !== undefined &&
        !['extensions', 'infrastructure'].includes(override.dashboardGroup)) {
        throw new Error(`${path}: "dashboardGroup" for "${repo}" must be extensions or infrastructure`);
      }
      if (override.application !== undefined && override.application !== true) {
        throw new Error(`${path}: "application" for "${repo}" may only be true`);
      }
      if (override.buildSource && override.buildSource !== 'fixed-editor-gui') {
        throw new Error(`${path}: unsupported buildSource for "${repo}"`);
      }
      if (override.pages !== undefined && override.pages !== false) {
        throw new Error(`${path}: "pages" for "${repo}" may only be false`);
      }
      if (override.demoPath !== undefined && (typeof override.demoPath !== 'string' ||
        !/^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.sb3$/.test(override.demoPath))) {
        throw new Error(`${path}: "demoPath" for "${repo}" must be a repository-relative SB3 path`);
      }
      if (override.editorCatalogHold !== undefined &&
        (typeof override.editorCatalogHold !== 'string' || !override.editorCatalogHold.trim())) {
        throw new Error(`${path}: "editorCatalogHold" for "${repo}" must say why it is held`);
      }
      if (override.releaseHold !== undefined &&
        (typeof override.releaseHold !== 'string' || !override.releaseHold.trim())) {
        throw new Error(`${path}: "releaseHold" for "${repo}" must say why it is held`);
      }
      if (override.testOnlyDependencies !== undefined && (!Array.isArray(override.testOnlyDependencies) ||
        !override.testOnlyDependencies.length ||
        override.testOnlyDependencies.some((name: unknown) => typeof name !== 'string' || !name.trim()))) {
        throw new Error(`${path}: "testOnlyDependencies" for "${repo}" must list package names`);
      }
      if (override.npmReason !== undefined && (override.npm !== false ||
        !override.npmReason || typeof override.npmReason.en !== 'string' || !override.npmReason.en.trim() ||
        typeof override.npmReason.ja !== 'string' || !override.npmReason.ja.trim())) {
        throw new Error(`${path}: npmReason for "${repo}" requires npm: false and English/Japanese reasons`);
      }
      entries.push({
        repo,
        category: category.id,
        ...(override.dashboardGroup ? { dashboardGroup: override.dashboardGroup } : {}),
        ...(override.application ? { application: true as const } : {}),
        npm: override.npm === false ? null : (override.npm ?? `${scope}/${repo}`),
        pages: override.pages !== false,
        ...(override.demoPath ? { demoPath: override.demoPath } : {}),
        ...(override.npmReason ? { npmReason: override.npmReason } : {}),
        note: override.note ?? null,
        label: override.label ?? repo,
        // Summaries are read from the repository's own READMEs; these only
        // exist for the cases where that text does not suit a table cell.
        description: override.description ?? null,
        descriptionJa: override.descriptionJa ?? null,
        ...(override.buildSource ? { buildSource: override.buildSource } : {}),
        ...(override.editorCatalogHold ? { editorCatalogHold: override.editorCatalogHold.trim() } : {}),
        ...(override.releaseHold ? { releaseHold: override.releaseHold.trim() } : {}),
        ...(override.testOnlyDependencies ? { testOnlyDependencies: [...override.testOnlyDependencies] } : {}),
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
    npmToRepo: new Map(entries.flatMap((e) => e.npm ? [[e.npm, e.repo] as const] : [])),
  };
}
