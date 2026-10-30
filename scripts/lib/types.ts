/** Shared catalog, API and dashboard data contracts. */
export interface SiteConfig {
  title?: string;
  tagline?: string;
  taglineJa?: string;
  disclaimer?: string;
  disclaimerJa?: string;
  repoUrl?: string;
  headerScript?: string;
  demoEditorUrl?: string;
}

export interface Category {
  id: string;
  title: string;
  titleJa?: string | null;
  description?: string | null;
  descriptionJa?: string | null;
}

export interface RawCatalog {
  owner: string;
  scope?: string;
  site?: SiteConfig;
  categories: (Category & { packages?: string[] })[];
  localProtocols?: string[];
  overrides?: Record<string, {
    npm?: string | false;
    note?: string;
    label?: string;
    description?: string;
    descriptionJa?: string;
    buildSource?: 'fixed-editor-gui';
  }>;
}

export interface CatalogEntry {
  repo: string;
  category: string;
  npm: string | null;
  note: string | null;
  label: string;
  description: string | null;
  descriptionJa: string | null;
  buildSource?: 'fixed-editor-gui';
}

export interface Catalog {
  owner: string;
  scope: string;
  site: SiteConfig;
  localProtocols: string[];
  categories: Category[];
  entries: CatalogEntry[];
  npmToRepo: Map<string, string>;
}

export interface PackageManifest {
  name?: string;
  version?: string;
  description?: string;
  private?: boolean;
  license?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface Commit {
  oid: string;
  committedDate: string;
}

export interface TagNode {
  name: string;
  target?: { oid?: string; committedDate?: string; target?: Partial<Commit> };
}

export interface Release {
  tagName: string;
  publishedAt: string;
  url: string;
  isPrerelease: boolean;
}

export interface RepositoryNode {
  name: string;
  description: string | null;
  url: string;
  homepageUrl: string | null;
  isArchived: boolean;
  isPrivate: boolean;
  isFork: boolean;
  pushedAt: string | null;
  stargazerCount: number;
  licenseInfo?: { spdxId: string } | null;
  issues?: { totalCount: number };
  pullRequests?: { totalCount: number };
  defaultBranchRef?: { name: string; target: Commit | null } | null;
  latestRelease?: Release | null;
  tags?: { nodes: TagNode[] };
  packageJson?: { text?: string } | null;
  readmeEn?: { text?: string } | null;
  readmeJa?: { text?: string } | null;
  blockIcon?: { text?: string } | null;
  samplesManifest?: { text?: string } | null;
  extensionConfig?: { text?: string } | null;
  viteConfig?: { text?: string } | null;
  fixedEditorSource?: { text?: string } | null;
  fixedEditorContract?: { text?: string } | null;
  fixedEditorBuild?: { text?: string } | null;
}

export interface RevisionStatus {
  state: 'empty' | 'untagged' | 'released' | 'unreleased';
  head: Commit | null;
  tag: { name: string; oid: string | null; committedDate: string | null } | null;
  release: Release | null;
  aheadBy: number | null;
}

export interface PagesStatus {
  enabled: boolean;
  url?: string | null;
  status?: string | null;
  buildType?: string | null;
  cname?: string | null;
  live?: boolean;
  httpStatus?: number | null;
  svgFaviconUrl?: string | null;
  faviconUrl?: string | null;
  error?: string;
}

export interface NpmStatus {
  name: string | null;
  published: boolean;
  notAPackage?: boolean;
  latest?: string | null;
  lastPublishedAt?: string | null;
  versionCount?: number;
  versions?: string[];
  deprecated?: string | null;
  distTags?: Record<string, string>;
  matchesTag?: boolean | null;
  error?: string;
}

export interface RangeVerdict {
  local: boolean;
  stale: boolean;
  unresolvable?: boolean;
  missing?: boolean;
  latest?: string;
  wanted?: string | null;
  behind?: string | null;
}

export interface DeclaredDependency {
  name: string;
  range: string;
  kind: 'prod' | 'peer' | 'optional' | 'dev';
  family: boolean;
}

export interface Dependency extends DeclaredDependency, RangeVerdict {
  error?: string;
}

export interface GitHubSummary {
  name: string;
  description: string | null;
  url: string;
  homepageUrl: string | null;
  isArchived: boolean;
  isPrivate: boolean;
  isFork: boolean;
  pushedAt: string | null;
  stars: number;
  license: string | null;
  openIssues: number;
  openPullRequests: number;
  defaultBranch: string | null;
}

export interface DashboardPackage {
  repo: string;
  label: string;
  category: string;
  note: string | null;
  errors: string[];
  github?: GitHubSummary;
  descriptions?: {
    en: string | null;
    ja: string | null;
    enSource: string | null;
    jaSource: string | null;
  };
  icon?: string | null;
  unsandboxed?: UnsandboxedRequirement;
  /** Repositories whose required declarations are inherited by this app or extension. */
  unsandboxedRequiredBy?: string[];
  demo?: DemoProject | null;
  revision?: RevisionStatus | null;
  pages?: PagesStatus;
  manifest?: {
    name: string | null;
    version: string | null;
    private: boolean;
    license: string | null;
  } | null;
  dependencies?: Dependency[];
  buildDependencies?: BuildDependency[];
  buildSourceError?: string;
  npm?: NpmStatus;
}

export interface BuildDependency {
  repo: string;
  revision: string;
  sourceRevision: string;
  sourcePath: 'site/source.json';
  contractPaths: ['scripts/site/source.mjs', 'scripts/site/build.mjs'];
}

export interface DemoProject {
  projectUrl: string;
  title: string;
}

export type UnsandboxedRequirement = 'required' | 'optional' | 'not-needed' | 'unknown';

export interface DashboardReport {
  generatedAt: string;
  collectionStartedAt?: string;
  catalog?: { sha256: string; revision: string | null };
  owner: string;
  scope: string;
  site: SiteConfig;
  categories: Category[];
  packages: DashboardPackage[];
}
