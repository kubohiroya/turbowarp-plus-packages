import { createHash } from 'node:crypto';
import semver from 'semver';
import { pool } from './github.ts';
import { errorMessage } from './errors.ts';
import { describeFromReadme } from './descriptions.ts';
import {catalogIconURL} from './extension-branding.ts';
import type { DashboardPackage, DashboardReport } from './types.ts';
import {readPackageResourceDeclaration, parseResourceDeclaration} from '@kubohiroya/turbowarp-extension-manifest/resources';
import type {ResourceDeclaration} from '@kubohiroya/turbowarp-extension-manifest/resources';

export interface EditorExtension {
  id: string;
  name: string;
  version: string;
  package: string;
  repository: string;
  docsURL?: string;
  url: string;
  /** SHA-256 (lowercase hex) of the exact bytes served at `url`. */
  sha256: string;
  category?: string;
  description?: string;
  descriptions?: Record<string, string>;
  author?: string;
  authorURL?: string;
  license?: string;
  banner?: string;
  unsandboxed?: 'required' | 'optional' | 'not-needed' | 'unknown';
  resourceDeclaration?: ResourceDeclaration;
  /**
   * Other builds of this extension that one published version ships, each pinned to its own
   * bytes. A project may carry any of them; the Editor and its review match each by digest.
   */
  variants?: EditorExtensionVariant[];
  dependencies: string[];
}
export interface EditorExtensionVariant {
  url: string;
  sha256: string;
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
/**
 * One extension a package declares in `package.json` at `turbowarpExtension.catalog`.
 *
 * A package that ships several extensions, or one extension in several builds, cannot be read by
 * guessing a `dist/*.js` file. It names them instead: the main build, the other builds of the same
 * extension, the extension IDs it needs beside it (none for a self-contained bundle — its npm
 * dependencies are what it bundles, not what a project must load), and optionally a resource
 * declaration of its own instead of the package's.
 */
export interface DeclaredCatalogExtension {
  artifact: string;
  variants?: string[];
  dependencies?: string[];
  resourceDeclaration?: unknown;
}
export interface PublishedManifest {
  turbowarpExtension?: {resourceDeclaration?: unknown; catalog?: unknown};
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
export interface PublishedExtension {
  entry: EditorExtension;
  manifest: PublishedManifest;
  /**
   * Extension IDs this entry needs, when its package declared them. Without it the dependencies
   * are read from the package manifest's npm dependencies.
   */
  declaredDependencies?: string[];
}

export interface ExtensionDisplayNameException {
  name: string;
  reason: string;
}

// Preserve an intentional product name only when its reason is recorded here.
export const EXTENSION_DISPLAY_NAME_EXCEPTIONS: Readonly<Record<string, ExtensionDisplayNameException>> = Object.freeze({});

/** Format this family's catalog labels without changing executable package identity. */
export function extensionDisplayName(
  name: string,
  packageName: string,
  exceptions: Readonly<Record<string, ExtensionDisplayNameException>> = EXTENSION_DISPLAY_NAME_EXCEPTIONS,
): string {
  if (!/^@kubohiroya\/turbowarp-[a-z0-9-]+$/.test(packageName)) return name;
  if (Object.hasOwn(exceptions, packageName)) {
    const exception = exceptions[packageName];
    if (!exception?.name?.trim() || !exception.reason?.trim()) {
      throw new Error(`Display name exception requires a name and reason: ${packageName}`);
    }
    return exception.name.trim();
  }
  const suffix = name.trim().replace(/^TurboWarp(?:[\s-]+|$)/i, '')
    .replace(/[\s/]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!suffix) throw new Error(`Missing extension display name: ${packageName}`);
  return `TurboWarp-${suffix}`;
}

/** Apply catalog-owned labels and illustrations without rewriting executable sources. */
export function catalogEntryPresentation(entry: EditorExtension): EditorExtension {
  parseResourceDeclaration(entry.resourceDeclaration);
  const banner = catalogIconURL(entry.package);
  return {...entry, name: extensionDisplayName(entry.name, entry.package), ...(banner ? {banner} : {})};
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
/** A picture the catalog can show as it is: an HTTPS address, or a small inline image. */
const banner = (value: string, base: string): string | undefined => {
  if (/^data:image\/(?:svg\+xml|png|webp)[;,]/i.test(value)) return value.length <= 16384 ? value : undefined;
  try {
    return secure(value, base);
  } catch {
    return undefined;
  }
};
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

/** A backoff wait that gives up the moment the caller's signal is aborted. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal!.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, {once: true});
  });
}

/**
 * One refused connection used to abandon the whole catalog and with it the
 * dashboard build. The transient cases are worth another go: a connection that
 * never opened, a rate limit, a 5xx. A 404 is an answer rather than a hiccup,
 * so it is not retried, and neither is anything once `signal` is aborted —
 * that abort means some sibling has already failed for good.
 */
async function request(url: string, {retries = 2, signal}: {retries?: number; signal?: AbortSignal} = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      const timeout = AbortSignal.timeout(30000);
      response = await fetch(url, {signal: signal ? AbortSignal.any([signal, timeout]) : timeout});
    } catch (cause) {
      signal?.throwIfAborted();
      if (attempt < retries) {
        await wait(500 * 2 ** attempt, signal);
        continue;
      }
      throw new Error(`${url}: unreachable`, { cause });
    }

    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await wait(500 * 2 ** attempt, signal);
        continue;
      }
      throw new Error(`${url}: HTTP ${response.status}`);
    }
    return response;
  }
}

/** Stable catalogs do not promote a prerelease merely because its publisher moved latest. */
async function publishedVersion(name: string, latest: string, allowPrerelease: boolean, signal?: AbortSignal): Promise<string> {
  if (!semver.valid(latest)) throw new Error(`Invalid published version: ${name}@${latest}`);
  if (allowPrerelease || !semver.prerelease(latest)) return latest;
  const registry = await request(`https://registry.npmjs.org/${name}`, {signal}).then(r => r.json()) as {
    versions?: Record<string, {deprecated?: string}>;
  };
  const candidates = Object.entries(registry.versions ?? {}).flatMap(([version, manifest]) =>
    semver.valid(version) && !semver.prerelease(version) && semver.lt(version, latest) && !manifest.deprecated ? [version] : []);
  const stable = semver.maxSatisfying(candidates, '*');
  if (!stable) throw new Error(`No non-deprecated stable version before ${name}@${latest}`);
  return stable;
}

/**
 * Discover the primary runnable artifact in an exact npm version, never in a
 * moving branch.
 *
 * Every request for one package shares an abort scope. The pair below runs
 * concurrently, so without it the surviving request would go on retrying into
 * a result nobody is left to read.
 */
export async function publishedExtension(
  pkg: DashboardPackage,
  options: {allowPrerelease?: boolean; signal?: AbortSignal} = {},
): Promise<PublishedExtension> {
  return (await publishedExtensions(pkg, options))[0]!;
}

/** Every extension one exact published version provides: the declared ones, or the one discovered. */
export async function publishedExtensions(
  pkg: DashboardPackage,
  {allowPrerelease = false, signal}: {allowPrerelease?: boolean; signal?: AbortSignal} = {},
): Promise<PublishedExtension[]> {
  const scope = new AbortController();
  try {
    return await readPublishedExtensions(pkg, allowPrerelease,
      signal ? AbortSignal.any([signal, scope.signal]) : scope.signal);
  } catch (error) {
    scope.abort(error);
    throw error;
  }
}

/** `turbowarpExtension.catalog`, checked for shape only; the artifacts themselves are read next. */
export function declaredCatalog(manifest: PublishedManifest): DeclaredCatalogExtension[] | undefined {
  const declared = manifest.turbowarpExtension?.catalog;
  if (declared === undefined) return undefined;
  const path = (value: unknown) => typeof value === 'string' && /^dist\/[\w./-]+\.js$/.test(value) && !value.includes('..');
  if (!Array.isArray(declared) || declared.length === 0 || declared.length > 16) {
    throw new Error(`${manifest.name}: turbowarpExtension.catalog must list 1-16 extensions`);
  }
  return declared.map((item: unknown) => {
    const record = item as Record<string, unknown>;
    if (!record || typeof record !== 'object' || !path(record.artifact) ||
      (record.variants !== undefined && (!Array.isArray(record.variants) || record.variants.length > 32 || !record.variants.every(path))) ||
      (record.dependencies !== undefined && (!Array.isArray(record.dependencies) ||
        !record.dependencies.every(id => typeof id === 'string' && /^[a-zA-Z0-9]+$/.test(id))))) {
      throw new Error(`${manifest.name}: invalid turbowarpExtension.catalog entry`);
    }
    return record as unknown as DeclaredCatalogExtension;
  });
}

async function readPublishedExtensions(pkg: DashboardPackage, allowPrerelease: boolean, signal: AbortSignal): Promise<PublishedExtension[]> {
  const name = pkg.npm!.name!;
  const version = await publishedVersion(name, pkg.npm!.latest!, allowPrerelease, signal);
  const base = `https://cdn.jsdelivr.net/npm/${name}@${version}`;
  // The listing is only needed when the package declares nothing, but asking for both at once
  // keeps the common case to one round trip.
  const [manifest, tree] = await Promise.all([
    request(`${base}/package.json`, {signal}).then(r => r.json()) as Promise<PublishedManifest>,
    request(`https://data.jsdelivr.com/v1/package/npm/${name}@${version}/flat`, {signal}).then(r => r.json()) as Promise<{ files: { name: string }[] }>,
  ]);
  if (manifest.name !== name || manifest.version !== version) {
    throw new Error(`Published manifest mismatch: ${name}@${version}`);
  }
  const declared = declaredCatalog(manifest);
  if (declared) return readDeclaredExtensions(pkg, manifest, base, declared, signal);
  return [await readDiscoveredExtension(pkg, manifest, base, tree, signal)];
}

/** The fields every catalog entry takes from one published artifact's header. */
function headerEntry(pkg: DashboardPackage, manifest: PublishedManifest, url: string, bytes: Uint8Array,
  metadata: Record<string, string>, descriptions: Record<string, string>, picture: string | undefined,
  resourceDeclaration: ResourceDeclaration | undefined): EditorExtension {
  const unsandboxed = metadata.unsandboxed === 'true' ? 'required' : metadata.unsandboxed === 'false' ? 'not-needed' :
    ['required', 'optional', 'not-needed'].includes(metadata.unsandboxed) ? metadata.unsandboxed as EditorExtension['unsandboxed'] : 'unknown';
  if (!pkg.github?.url) throw new Error(`Missing repository URL: ${pkg.repo}`);
  const docsURL = extensionDocsURL(pkg);
  return {
    id: metadata.id, name: metadata.name, package: manifest.name!, version: manifest.version!, url,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    category: pkg.category,
    repository: secure(pkg.github.url),
    ...(docsURL ? {docsURL} : {}),
    description: metadata.description,
    descriptions,
    ...extensionAuthor(metadata, manifest),
    license: metadata.license ?? manifest.license,
    ...(picture ? { banner: picture } : {}),
    unsandboxed,
    ...(resourceDeclaration !== undefined ? {resourceDeclaration} : {}),
    dependencies: [],
  };
}

const headerDescriptions = (metadata: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(metadata).flatMap(([key, value]) => {
    const locale = /^description\[([a-z]{2,8}(?:-[a-z0-9]{1,8})*)\]$/.exec(key)?.[1];
    return locale ? [[locale, value]] : [];
  }));

/**
 * The extensions a package names in `turbowarpExtension.catalog`, each with its other builds.
 *
 * Every build must state the same extension ID in its header, so a variant can only ever be the
 * extension it is listed under. Builds whose bytes are identical are listed once.
 */
async function readDeclaredExtensions(pkg: DashboardPackage, manifest: PublishedManifest, base: string,
  declared: DeclaredCatalogExtension[], signal: AbortSignal): Promise<PublishedExtension[]> {
  const packageDeclaration = readPackageResourceDeclaration(manifest);
  const read = async (artifact: string) => {
    const url = `${base}/${artifact}`;
    const bytes = new Uint8Array(await (await request(url, {signal})).arrayBuffer());
    return {url, bytes, metadata: extensionHeader(new TextDecoder().decode(bytes))};
  };
  const records: PublishedExtension[] = [];
  for (const item of declared) {
    const main = await read(item.artifact);
    const {metadata} = main;
    if (!/^[a-zA-Z0-9]+$/.test(metadata.id ?? '') || !metadata.name) {
      throw new Error(`No runnable extension header in ${manifest.name}@${manifest.version}/${item.artifact}`);
    }
    const resourceDeclaration = item.resourceDeclaration !== undefined ?
      parseResourceDeclaration(item.resourceDeclaration) : packageDeclaration;
    const entry = headerEntry(pkg, manifest, main.url, main.bytes, metadata, headerDescriptions(metadata),
      metadata.banner ? banner(metadata.banner, main.url) : undefined, resourceDeclaration);
    const seen = new Set([entry.sha256]);
    const variants: EditorExtensionVariant[] = [];
    for (const artifact of item.variants ?? []) {
      const variant = await read(artifact);
      if (variant.metadata.id !== metadata.id) {
        throw new Error(`${manifest.name}@${manifest.version}/${artifact} is not a build of ${metadata.id}`);
      }
      const sha256 = createHash('sha256').update(variant.bytes).digest('hex');
      if (seen.has(sha256)) continue;
      seen.add(sha256);
      variants.push({url: variant.url, sha256});
    }
    records.push({manifest, declaredDependencies: [...(item.dependencies ?? [])],
      entry: {...entry, ...(variants.length ? {variants} : {})}});
  }
  return records;
}

async function readDiscoveredExtension(pkg: DashboardPackage, manifest: PublishedManifest, base: string,
  tree: { files: { name: string }[] }, signal: AbortSignal): Promise<PublishedExtension> {
  const name = manifest.name!;
  const resourceDeclaration = readPackageResourceDeclaration(manifest);
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
    const response = await request(url, {signal});
    const bytes = new Uint8Array(await response.arrayBuffer());
    const source = new TextDecoder().decode(bytes);
    const metadata = extensionHeader(source);
    if (!/^[a-zA-Z0-9]+$/.test(metadata.id ?? '') || !metadata.name) continue;
    const descriptions = headerDescriptions(metadata);
    if (!descriptions.ja && tree.files.some(file => file.name === '/README.ja.md')) {
      const readme = await request(`${base}/README.ja.md`, {signal}).then(response => response.text());
      const summary = describeFromReadme(readme, {names: [name, pkg.repo]});
      if (summary) descriptions.ja = summary;
    }
    const bannerPath = ['/assets/banner.svg', '/assets/banner.png', '/assets/block-icon.svg']
      .find(candidate => tree.files.some(file => file.name === candidate));
    const picture = metadata.banner ? secure(metadata.banner, url) : bannerPath ? `${base}${bannerPath}` : undefined;
    return { manifest, entry: headerEntry(pkg, manifest, url, bytes, metadata, descriptions, picture, resourceDeclaration) };
  }
  throw new Error(`No runnable extension header in ${name}@${manifest.version}`);
}

/** A package's first record stands for it when another package depends on it by npm name. */
function firstByPackage(published: readonly PublishedExtension[]): Map<string, PublishedExtension> {
  const byPackage = new Map<string, PublishedExtension>();
  for (const record of published) if (!byPackage.has(record.entry.package)) byPackage.set(record.entry.package, record);
  return byPackage;
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
  const byPackage = firstByPackage(published);
  // Only a package that declares its extensions may provide more than one.
  for (const [name, record] of byPackage) {
    if (!record.declaredDependencies && published.filter(other => other.entry.package === name).length > 1) {
      throw new Error('Duplicate extension package');
    }
  }
  const ids = new Set<string>();
  const extensions = published.map(({entry, manifest, declaredDependencies}) => {
    if (categories !== undefined && (!entry.category || !categoryIds.has(entry.category))) {
      throw new Error(`Unknown extension category: ${entry.package} refers to ${entry.category ?? '(missing)'}`);
    }
    if (!/^[a-zA-Z0-9]+$/.test(entry.id)) throw new Error(`Invalid extension ID: ${entry.id}`);
    if (ids.has(entry.id)) throw new Error(`Duplicate extension ID: ${entry.id}`);
    ids.add(entry.id);
    const dependencyIds = declaredDependencies ? [...declaredDependencies] : manifestDependencies(manifest).flatMap(([name, range]) => {
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
    return {...catalogEntryPresentation(entry), dependencies: [...new Set(dependencyIds)]};
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(extensions.map(entry => [entry.id, entry]));
  for (const entry of extensions) {
    for (const dependency of entry.dependencies) {
      if (!byId.has(dependency)) throw new Error(`Missing extension dependency: ${entry.id} requires ${dependency}`);
    }
  }
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

/**
 * What one failing package carries over from, and how long it has been
 * failing. Kept out of `extensions-v1.json`: this is our bookkeeping, not part
 * of the published contract.
 */
export interface CatalogFailure {
  /** Consecutive runs that have failed, this one included. */
  attempts: number;
  error: string;
  /** When the run of failures started. */
  since: string;
}

export interface CatalogState {
  schemaVersion: 1;
  savedAt: string;
  /** The records behind the catalog we just published, manifests included. */
  published: PublishedExtension[];
  failures: Record<string, CatalogFailure>;
}

export interface CatalogCollection {
  catalog: EditorCatalog;
  /** Feed this back as `previous` on the next run. */
  state: CatalogState;
  carriedOver: {package: string; attempts: number; error: string}[];
  /** Left out of this catalog because a dependency's selected version is outside the published range. */
  excluded: {package: string; version: string; reason: string}[];
}

const manifestDependencies = (manifest: PublishedManifest) =>
  [...Object.entries({...manifest.dependencies, ...manifest.optionalDependencies}), ...Object.entries(manifest.peerDependencies ?? {})];

/**
 * Leave out every extension whose dependency resolves to a version outside its
 * published range, and everything that depends on one left out.
 *
 * A family release in progress publishes upstream packages before their
 * dependents, and a stable catalog picks the previous stable release of a
 * package whose `latest` is a prerelease. Either way one extension can require
 * a version range the catalog does not hold. That used to cost the whole
 * dashboard its publication. The Editor loads a project's extensions
 * all-or-nothing, so an extension that cannot be satisfied is dropped together
 * with its dependents rather than listed with a broken dependency.
 *
 * `held` names extensions left out on purpose (catalog.yaml `editorCatalogHold`)
 * with the reason. They are dropped the same way, dependents included.
 */
export function excludeIncompatible(published: PublishedExtension[], held: ReadonlyMap<string, string> = new Map()): {
  kept: PublishedExtension[]; excluded: CatalogCollection['excluded'];
} {
  const byPackage = firstByPackage(published);
  const excluded = new Map<string, string>(published.flatMap(({entry}) =>
    held.has(entry.package) ? [[entry.package, `held: ${held.get(entry.package)}`] as const] : []));
  for (let changed = true; changed;) {
    changed = false;
    for (const {entry, manifest, declaredDependencies} of published) {
      // A declared bundle carries what its npm dependencies provide; their versions bind nothing here.
      if (excluded.has(entry.package) || declaredDependencies) continue;
      for (const [name, range] of manifestDependencies(manifest)) {
        const dependency = byPackage.get(name);
        const reason = excluded.has(name) ? `${name} is left out` :
          dependency && !semver.satisfies(dependency.entry.version, range) ? `requires ${name}@${range}, the catalog has ${dependency.entry.version}` : undefined;
        if (reason) {
          excluded.set(entry.package, reason);
          changed = true;
          break;
        }
      }
    }
  }
  return {
    kept: published.filter(record => !excluded.has(record.entry.package)),
    excluded: published.flatMap(({entry}) => excluded.has(entry.package) ?
      [{package: entry.package, version: entry.version, reason: excluded.get(entry.package)!}] : []),
  };
}

/**
 * Only the fields this module declares are worth keeping. The rest of a
 * package.json — scripts, devDependencies — is noise in a file we restore on
 * every run.
 */
function persistableManifest({name, version, jsdelivr, unpkg, author, license,
  dependencies, peerDependencies, optionalDependencies}: PublishedManifest): PublishedManifest {
  return Object.fromEntries(Object.entries({name, version, jsdelivr, unpkg, author, license,
    dependencies, peerDependencies, optionalDependencies}).filter(([, value]) => value !== undefined));
}

/**
 * Local facts are re-read even for a carried-over entry: a package moved to
 * another category, or a docs site that went down, is knowledge we already
 * have in `data/dashboard.json` and should not keep stale copies of. Only what
 * had to be fetched — version, URL, hash, name, description, banner — comes
 * from the previous run.
 */
function withCurrentLocalFields(kept: PublishedExtension, pkg: DashboardPackage): PublishedExtension {
  const entry = {...kept.entry, category: pkg.category};
  delete entry.docsURL;
  const docsURL = extensionDocsURL(pkg);
  return {...kept, entry: docsURL ? {...entry, docsURL} : entry};
}

/**
 * A package whose build declares an extension, or which names its extensions in package.json.
 * Apps and toolchains are never catalog entries, whatever they declare.
 */
export function isExtensionPackage(pkg: DashboardPackage): boolean {
  return (pkg.unsandboxed !== undefined || pkg.extensionCatalog === true) && !['apps', 'toolchain'].includes(pkg.category);
}

/**
 * Collect every publishable extension, falling back to the previous run for
 * any package that cannot be read right now.
 *
 * A single unreachable package used to cost the whole dashboard its
 * publication. It cannot simply be dropped either: `assembleEditorCatalog`
 * validates dependencies between extensions, so removing one would break
 * every extension that depends on it, and the Editor loads a project's
 * extensions all-or-nothing. So a failure keeps the last known-good record
 * instead — but only for `maxAttempts` runs in a row. Past that it is no
 * longer a hiccup, and the build fails rather than publishing a stale entry
 * indefinitely. A package with nothing to fall back on fails immediately.
 */
export async function collectEditorCatalog(report: DashboardReport, {allowPrerelease = false, previous, maxAttempts = 3}: {
  allowPrerelease?: boolean;
  previous?: CatalogState;
  maxAttempts?: number;
} = {}): Promise<CatalogCollection> {
  const candidates = report.packages.filter(pkg => isExtensionPackage(pkg) && pkg.npm?.published && pkg.npm.latest &&
    !pkg.npm.deprecated && !pkg.github?.isArchived);
  const results = await pool(candidates, 4, async pkg => {
    try {
      return {pkg, records: await publishedExtensions(pkg, {allowPrerelease})};
    } catch (error) {
      // Held, not thrown: the other packages are still worth collecting, and
      // whether this one is fatal depends on what the previous run left us.
      return {pkg, error: errorMessage(error)};
    }
  });

  const keptByPackage = new Map<string, PublishedExtension[]>();
  for (const record of previous?.published ?? []) {
    keptByPackage.set(record.entry.package, [...(keptByPackage.get(record.entry.package) ?? []), record]);
  }
  const savedAt = new Date().toISOString();
  const published: PublishedExtension[] = [];
  const failures: Record<string, CatalogFailure> = {};
  const carriedOver: CatalogCollection['carriedOver'] = [];
  const fatal: string[] = [];

  for (const result of results) {
    if (result.records) {
      published.push(...result.records);
      continue;
    }
    const name = result.pkg.npm!.name!;
    const kept = keptByPackage.get(name);
    const previousFailure = previous?.failures[name];
    const attempts = (previousFailure?.attempts ?? 0) + 1;
    if (!kept) {
      fatal.push(`${name}: ${result.error} (nothing published previously to fall back on)`);
      continue;
    }
    if (attempts > maxAttempts) {
      fatal.push(`${name}: ${result.error} (${attempts} consecutive runs have failed since ${previousFailure!.since})`);
      continue;
    }
    published.push(...kept.map(record => withCurrentLocalFields(record, result.pkg)));
    failures[name] = {attempts, error: result.error!, since: previousFailure?.since ?? savedAt};
    carriedOver.push({package: name, attempts, error: result.error!});
  }
  if (fatal.length > 0) {
    throw new Error(`Cannot build the extension catalog:\n  ${fatal.join('\n  ')}`);
  }

  const knownExtensions = new Set(report.packages.filter(isExtensionPackage).flatMap(pkg => pkg.npm?.name ? [pkg.npm.name] : []));
  const categories = report.categories.map(({id, title, titleJa}) => ({id, title, ...(titleJa != null ? {titleJa} : {})}));
  const held = new Map(report.packages.flatMap(pkg =>
    pkg.editorCatalogHold && pkg.npm?.name ? [[pkg.npm.name, pkg.editorCatalogHold] as const] : []));
  const {kept, excluded} = excludeIncompatible(published, held);
  return {
    catalog: assembleEditorCatalog(report.generatedAt, kept, knownExtensions, categories),
    state: {schemaVersion: 1, savedAt, failures,
      published: kept.map(record => ({...record, manifest: persistableManifest(record.manifest)}))},
    carriedOver,
    excluded,
  };
}
