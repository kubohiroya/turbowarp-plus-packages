import semver from 'semver';
import { pool } from './github.ts';
import { describeFromReadme } from './descriptions.ts';
import type { DashboardPackage, DashboardReport } from './types.ts';

export interface EditorExtension {
  id: string;
  name: string;
  version: string;
  package: string;
  repository: string;
  docsURL?: string;
  url: string;
  category?: string;
  description?: string;
  descriptions?: Record<string, string>;
  author?: string;
  authorURL?: string;
  license?: string;
  banner?: string;
  unsandboxed?: 'required' | 'optional' | 'not-needed' | 'unknown';
  dependencies: string[];
}
export interface EditorCategory {
  id: string;
  title: string;
  titleJa?: string;
}
export interface EditorCatalog {
  schemaVersion: 1;
  generatedAt: string;
  categories?: EditorCategory[];
  extensions: EditorExtension[];
}
interface PublishedManifest {
  name?: string;
  version?: string;
  jsdelivr?: string;
  unpkg?: string;
  author?: string | {name?: string; url?: string};
  license?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
interface PublishedExtension {
  entry: EditorExtension;
  manifest: PublishedManifest;
}

/** Only declaration comments at the start of a published bundle are metadata. */
export function extensionHeader(source: string): Record<string, string> {
  const header = source.slice(0, 16384).match(/^\s*(?:(?:\/\/[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/)\s*)*/)?.[0] ?? '';
  const values: Record<string, string> = {};
  for (const line of header.split('\n')) {
    if (/^\s*(?:\/\/|\/\*|\*)\s*Bundled extensions:\s*$/i.test(line)) break;
    const match = /^\s*(?:\/\/|\/\*|\*)\s*([\w -]+(?:\[[\w-]+\])?):\s*(.*?)\s*(?:\*\/)?$/.exec(line);
    if (match && !Object.hasOwn(values, match[1].toLowerCase())) values[match[1].toLowerCase()] = match[2];
  }
  return values;
}
const secure = (value: string, base?: string): string => {
  const url = new URL(value, base);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`Expected HTTPS: ${value}`);
  return url.href;
};

/** Documentation links come only from a configured Pages site with a successful health check. */
export function extensionDocsURL(pkg: DashboardPackage): string | undefined {
  if (!pkg.pages?.enabled || pkg.pages.live !== true || pkg.pages.httpStatus !== 200 || !pkg.pages.url) return undefined;
  try {
    return secure(pkg.pages.url);
  } catch {
    return undefined;
  }
}

/** The published manifest is the only source of author links. */
export function extensionAuthor(metadata: Record<string, string>, manifest: PublishedManifest): Pick<EditorExtension, 'author' | 'authorURL'> {
  let manifestName: string | undefined;
  let manifestURL: string | undefined;
  if (typeof manifest.author === 'string') {
    const person = /^\s*([^<()]+?)\s*(?:<[^>]*>\s*)?(?:\(([^()]*)\)\s*)?$/.exec(manifest.author);
    manifestName = person?.[1].trim() || undefined;
  } else if (manifest.author && typeof manifest.author === 'object') {
    manifestName = typeof manifest.author.name === 'string' ? manifest.author.name.trim() || undefined : undefined;
    manifestURL = typeof manifest.author.url === 'string' ? manifest.author.url : undefined;
  }
  const author = manifestName ?? metadata.author ?? metadata.by;
  let authorURL: string | undefined;
  if (manifestURL) {
    try {
      const url = new URL(manifestURL);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) authorURL = url.href;
    } catch { /* An invalid optional author link does not prevent extension loading. */ }
  }
  return {...(author !== undefined ? {author} : {}), ...(authorURL ? {authorURL} : {})};
}

async function request(url: string): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

/** Discover the primary runnable artifact in an exact npm version, never in a moving branch. */
export async function publishedExtension(pkg: DashboardPackage): Promise<PublishedExtension> {
  const name = pkg.npm!.name!;
  const version = pkg.npm!.latest!;
  if (!semver.valid(version)) throw new Error(`Invalid published version: ${name}@${version}`);
  const base = `https://cdn.jsdelivr.net/npm/${name}@${version}`;
  const [manifest, tree] = await Promise.all([
    request(`${base}/package.json`).then(r => r.json()) as Promise<PublishedManifest>,
    request(`https://data.jsdelivr.com/v1/package/npm/${name}@${version}/flat`).then(r => r.json()) as Promise<{ files: { name: string }[] }>,
  ]);
  if (manifest.name !== name || manifest.version !== version) {
    throw new Error(`Published manifest mismatch: ${name}@${version}`);
  }
  const paths = tree.files.map(f => f.name).filter(path => /^\/dist\/[^/]+\.js$/.test(path));
  const preferred = [manifest.jsdelivr, manifest.unpkg].filter((path): path is string => typeof path === 'string')
    .map(path => `/${path.replace(/^\.\//, '').replace(/^\//, '')}`);
  preferred.push(`/dist/${pkg.repo}.js`, `/dist/${pkg.repo.replace(/^turbowarp-/, '')}.js`);
  paths.sort((a, b) => {
    const rank = (path: string) => preferred.includes(path) ? preferred.indexOf(path) : preferred.length;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  for (const path of paths) {
    const url = `${base}${path}`;
    const source = await request(url).then(r => r.text());
    const metadata = extensionHeader(source);
    if (!/^[a-zA-Z0-9]+$/.test(metadata.id ?? '') || !metadata.name) continue;
    const descriptions: Record<string, string> = Object.fromEntries(Object.entries(metadata).flatMap(([key, value]) => {
      const locale = /^description\[([a-z]{2,8}(?:-[a-z0-9]{1,8})*)\]$/.exec(key)?.[1];
      return locale ? [[locale, value]] : [];
    }));
    if (!descriptions.ja && tree.files.some(file => file.name === '/README.ja.md')) {
      const readme = await request(`${base}/README.ja.md`).then(response => response.text());
      const summary = describeFromReadme(readme, {names: [name, pkg.repo]});
      if (summary) descriptions.ja = summary;
    }
    const bannerPath = ['/assets/banner.svg', '/assets/banner.png', '/assets/block-icon.svg']
      .find(candidate => tree.files.some(file => file.name === candidate));
    const banner = metadata.banner ? secure(metadata.banner, url) : bannerPath ? `${base}${bannerPath}` : undefined;
    const unsandboxed = metadata.unsandboxed === 'true' ? 'required' : metadata.unsandboxed === 'false' ? 'not-needed' :
      ['required', 'optional', 'not-needed'].includes(metadata.unsandboxed) ? metadata.unsandboxed as EditorExtension['unsandboxed'] : 'unknown';
    if (!pkg.github?.url) throw new Error(`Missing repository URL: ${pkg.repo}`);
    const docsURL = extensionDocsURL(pkg);
    return { manifest, entry: {
      id: metadata.id, name: metadata.name, package: name, version, url,
      category: pkg.category,
      repository: secure(pkg.github.url),
      ...(docsURL ? {docsURL} : {}),
      description: metadata.description,
      descriptions,
      ...extensionAuthor(metadata, manifest),
      license: metadata.license ?? manifest.license,
      ...(banner ? { banner } : {}),
      unsandboxed,
      dependencies: [],
    } };
  }
  throw new Error(`No runnable extension header in ${name}@${version}`);
}

/** Dependencies are extension IDs, not npm build libraries. The published manifest is authoritative. */
export function assembleEditorCatalog(
  generatedAt: string,
  published: PublishedExtension[],
  knownExtensions = new Set<string>(),
  categories?: readonly EditorCategory[],
): EditorCatalog {
  const categoryIds = new Set<string>();
  const catalogCategories = categories?.map(({id, title, titleJa}) => {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) || typeof title !== 'string' || !title.trim() ||
      (titleJa !== undefined && (typeof titleJa !== 'string' || !titleJa.trim()))) throw new Error('Invalid extension category');
    if (categoryIds.has(id)) throw new Error(`Duplicate extension category: ${id}`);
    categoryIds.add(id);
    return {id, title, ...(titleJa !== undefined ? {titleJa} : {})};
  });
  const byPackage = new Map(published.map(record => [record.entry.package, record]));
  if (byPackage.size !== published.length) throw new Error('Duplicate extension package');
  const ids = new Set<string>();
  const extensions = published.map(({entry, manifest}) => {
    if (categories !== undefined && (!entry.category || !categoryIds.has(entry.category))) {
      throw new Error(`Unknown extension category: ${entry.package} refers to ${entry.category ?? '(missing)'}`);
    }
    if (!/^[a-zA-Z0-9]+$/.test(entry.id)) throw new Error(`Invalid extension ID: ${entry.id}`);
    if (ids.has(entry.id)) throw new Error(`Duplicate extension ID: ${entry.id}`);
    ids.add(entry.id);
    const dependencies = [...Object.entries({...manifest.dependencies, ...manifest.optionalDependencies}), ...Object.entries(manifest.peerDependencies ?? {})];
    const dependencyIds = dependencies.flatMap(([name, range]) => {
      const dependency = byPackage.get(name);
      if (!dependency) {
        if (knownExtensions.has(name)) throw new Error(`Missing extension dependency: ${entry.package} requires ${name}`);
        return [];
      }
      if (!semver.satisfies(dependency.entry.version, range)) {
        throw new Error(`Incompatible extension dependency: ${entry.package} requires ${name}@${range}`);
      }
      return [dependency.entry.id];
    });
    return {...entry, dependencies: [...new Set(dependencyIds)]};
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(extensions.map(entry => [entry.id, entry]));
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Cyclic extension dependency: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
  return { schemaVersion: 1, generatedAt, ...(catalogCategories !== undefined ? {categories: catalogCategories} : {}), extensions };
}

export async function collectEditorCatalog(report: DashboardReport): Promise<EditorCatalog> {
  const candidates = report.packages.filter(pkg => pkg.unsandboxed !== undefined &&
    !['apps', 'toolchain'].includes(pkg.category) && pkg.npm?.published && pkg.npm.latest &&
    !pkg.npm.deprecated && !pkg.github?.isArchived);
  const published = await pool(candidates, 4, publishedExtension);
  const knownExtensions = new Set(report.packages.filter(pkg => pkg.unsandboxed !== undefined &&
    !['apps', 'toolchain'].includes(pkg.category)).flatMap(pkg => pkg.npm?.name ? [pkg.npm.name] : []));
  const categories = report.categories.map(({id, title, titleJa}) => ({id, title, ...(titleJa != null ? {titleJa} : {})}));
  return assembleEditorCatalog(report.generatedAt, published, knownExtensions, categories);
}
