#!/usr/bin/env node
/**
 * Collects everything the dashboard shows into data/dashboard.json.
 *
 * Sources: the GitHub GraphQL API (one query per batch of repositories), the
 * GitHub REST API (Pages configuration, and commit comparison when a release
 * tag is behind the default branch), and the npm registry.
 *
 * A failure on one package is recorded against that package and does not stop
 * the run: a dashboard that is mostly right is more useful than no dashboard.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

import { loadCatalog } from './lib/catalog.mjs';
import { graphql, rest, pool } from './lib/github.mjs';
import { packageStatus, allVersions } from './lib/npm.mjs';
import { declaredDependencies, evaluateRange } from './lib/dependencies.mjs';
import { describeFromReadme, looksJapanese } from './lib/descriptions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'dashboard.json');
const BATCH_SIZE = 15;

const REPO_FIELDS = `
  name
  description
  url
  homepageUrl
  isArchived
  isPrivate
  isFork
  pushedAt
  stargazerCount
  licenseInfo { spdxId }
  issues(states: OPEN) { totalCount }
  pullRequests(states: OPEN) { totalCount }
  defaultBranchRef {
    name
    target { ... on Commit { oid committedDate } }
  }
  latestRelease { tagName publishedAt url isPrerelease }
  tags: refs(refPrefix: "refs/tags/", first: 1, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
    nodes {
      name
      target {
        oid
        ... on Commit { committedDate }
        ... on Tag { target { ... on Commit { oid committedDate } } }
      }
    }
  }
  packageJson: object(expression: "HEAD:package.json") { ... on Blob { text } }
  readmeEn: object(expression: "HEAD:README.md") { ... on Blob { text } }
  readmeJa: object(expression: "HEAD:README.ja.md") { ... on Blob { text } }
  blockIcon: object(expression: "HEAD:assets/block-icon.svg") { ... on Blob { text } }
`;

/**
 * The extension's palette icon, if the repository commits one.
 *
 * It is inlined into the page rather than linked, so that it takes the row's
 * colour scheme and costs no extra request. Markup that could do anything is
 * refused rather than sanitised: an icon that cannot be shown safely is better
 * left out than quietly rewritten.
 */
function blockIcon(node) {
  const svg = node.blockIcon?.text?.trim();
  if (!svg || !svg.startsWith('<svg')) return null;
  if (/<script|<foreignObject|\son\w+\s*=|javascript:/i.test(svg)) return null;
  return svg;
}

/**
 * The summary in each language, and where it came from.
 *
 * Which file a summary lives in does not decide its language: some repositories
 * describe themselves in Japanese in README.md, and some carry a Japanese
 * repository description on GitHub. So every candidate is sorted by the script
 * it is actually written in, and the first one of each language wins.
 */
function describe(node, entry) {
  const names = [entry.npm, entry.repo].filter(Boolean);

  // Most specific first: a file named .ja is the strongest claim to Japanese,
  // then the curated one-liner, then the main README.
  let manifestDescription = null;
  try {
    manifestDescription = JSON.parse(node.packageJson?.text ?? '{}').description ?? null;
  } catch {
    // A manifest we cannot parse is reported elsewhere; here it just has no summary.
  }

  const candidates = [
    ['readme-ja', describeFromReadme(node.readmeJa?.text, { names })],
    ['github', node.description ?? null],
    ['package.json', manifestDescription],
    ['readme', describeFromReadme(node.readmeEn?.text, { names })],
  ].filter(([, text]) => Boolean(text));

  const japanese = candidates.find(([, text]) => looksJapanese(text));
  const english = candidates.find(([, text]) => !looksJapanese(text));

  const ja = entry.descriptionJa ?? japanese?.[1] ?? null;
  // With nothing in English, the Japanese text stands in: showing the summary
  // that exists beats showing an empty cell.
  const en = entry.description ?? english?.[1] ?? ja;

  return {
    en,
    ja,
    enSource: entry.description ? 'catalog' : (english?.[0] ?? (ja ? 'japanese-fallback' : null)),
    jaSource: entry.descriptionJa ? 'catalog' : (japanese?.[0] ?? null),
  };
}

async function fetchRepositories(owner, repoNames) {
  const results = new Map();

  for (let i = 0; i < repoNames.length; i += BATCH_SIZE) {
    const batch = repoNames.slice(i, i + BATCH_SIZE);
    const query = `query($owner: String!) {
      ${batch
        .map((name, index) => `r${index}: repository(owner: $owner, name: "${name}") { ${REPO_FIELDS} }`)
        .join('\n')}
    }`;

    const { data, errors } = await graphql(query, { owner });
    for (const error of errors) {
      // A missing repository comes back as a null field plus an error entry;
      // the other repositories in the batch are still usable.
      console.warn(`graphql: ${error.message}`);
    }
    batch.forEach((name, index) => {
      results.set(name, data[`r${index}`] ?? null);
    });
  }

  return results;
}

/** The tag's commit, following annotated tags through to their target. */
function tagCommit(tagNode) {
  if (!tagNode) return null;
  const target = tagNode.target ?? {};
  const commit = target.target ?? target;
  return {
    name: tagNode.name,
    oid: commit.oid ?? target.oid ?? null,
    committedDate: commit.committedDate ?? null,
  };
}

async function revisionStatus(owner, repo, node) {
  const head = node.defaultBranchRef?.target ?? null;
  const tag = tagCommit(node.tags?.nodes?.[0] ?? null);

  if (!head) return { state: 'empty', head: null, tag: null, release: null, aheadBy: null };

  const release = node.latestRelease
    ? {
        tagName: node.latestRelease.tagName,
        publishedAt: node.latestRelease.publishedAt,
        url: node.latestRelease.url,
        isPrerelease: node.latestRelease.isPrerelease,
      }
    : null;

  const base = {
    head: { oid: head.oid, committedDate: head.committedDate },
    tag,
    release,
  };

  if (!tag?.oid) return { ...base, state: 'untagged', aheadBy: null };
  if (tag.oid === head.oid) return { ...base, state: 'released', aheadBy: 0 };

  // Only ask how far ahead the branch is once we know it is ahead at all.
  let aheadBy = null;
  try {
    const comparison = await rest(
      `/repos/${owner}/${repo}/compare/${encodeURIComponent(tag.name)}...${head.oid}`,
    );
    aheadBy = comparison?.ahead_by ?? null;
  } catch (error) {
    console.warn(`compare failed for ${repo}: ${error.message}`);
  }

  return { ...base, state: 'unreleased', aheadBy };
}

/**
 * GitHub only fills in `status` for Pages sites built the legacy way; sites
 * deployed by a workflow report null. So we also ask the site itself whether
 * it is serving, which is the thing the dashboard actually claims.
 */
async function checkLive(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'turbowarp-plus-packages' },
    });
    // Drain the body so the socket can be reused.
    await response.arrayBuffer().catch(() => {});
    return { live: response.ok, httpStatus: response.status };
  } catch {
    return { live: false, httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
}

async function pagesStatus(owner, repo) {
  let pages = null;
  try {
    pages = await rest(`/repos/${owner}/${repo}/pages`);
  } catch (error) {
    console.warn(`pages failed for ${repo}: ${error.message}`);
    return { enabled: false, error: error.message };
  }

  if (!pages) return { enabled: false };

  const url = pages.html_url ?? null;
  const result = {
    enabled: true,
    url,
    status: pages.status ?? null,
    buildType: pages.build_type ?? null,
    cname: pages.cname ?? null,
  };

  if (url) Object.assign(result, await checkLive(url));
  return result;
}

/** Works out what to say about one declared dependency. */
async function analyseDependency({ name, range, kind, family, localProtocols }) {
  let versions = null;
  let error = null;
  try {
    versions = await allVersions(name);
  } catch (cause) {
    error = cause.message;
  }

  const verdict = evaluateRange({ range, versions, localProtocols });
  return { name, range, kind, family, ...verdict, ...(error ? { error } : {}) };
}

async function analyseDependencies(packageJsonText, { npmToRepo, localProtocols }) {
  if (!packageJsonText) return { manifest: null, dependencies: [] };

  let manifest;
  try {
    manifest = JSON.parse(packageJsonText);
  } catch (error) {
    return { manifest: null, dependencies: [], error: `package.json: ${error.message}` };
  }

  const declared = declaredDependencies(manifest, (name) => npmToRepo.has(name));
  const dependencies = await pool(declared, 8, (entry) =>
    analyseDependency({ ...entry, localProtocols }),
  );

  return {
    manifest: {
      name: manifest.name ?? null,
      version: manifest.version ?? null,
      private: manifest.private === true,
      license: manifest.license ?? null,
    },
    dependencies,
  };
}

async function main() {
  const catalog = await loadCatalog(join(ROOT, 'catalog.yaml'));
  const { owner, npmToRepo, localProtocols } = catalog;
  const repoNames = catalog.entries.map((entry) => entry.repo);

  console.log(`collecting ${repoNames.length} packages for ${owner}`);
  const repositories = await fetchRepositories(owner, repoNames);

  const packages = await pool(catalog.entries, 6, async (entry) => {
    const node = repositories.get(entry.repo);
    const record = {
      repo: entry.repo,
      label: entry.label,
      category: entry.category,
      note: entry.note,
      errors: [],
    };

    if (!node) {
      record.errors.push('repository not found');
      return record;
    }

    record.github = {
      name: node.name,
      description: node.description,
      url: node.url,
      homepageUrl: node.homepageUrl,
      isArchived: node.isArchived,
      isPrivate: node.isPrivate,
      isFork: node.isFork,
      pushedAt: node.pushedAt,
      stars: node.stargazerCount,
      license: node.licenseInfo?.spdxId ?? null,
      openIssues: node.issues?.totalCount ?? 0,
      openPullRequests: node.pullRequests?.totalCount ?? 0,
      defaultBranch: node.defaultBranchRef?.name ?? null,
    };

    record.descriptions = describe(node, entry);
    record.icon = blockIcon(node);

    const [revision, pages, deps] = await Promise.all([
      revisionStatus(owner, entry.repo, node).catch((error) => {
        record.errors.push(`revision: ${error.message}`);
        return null;
      }),
      pagesStatus(owner, entry.repo),
      analyseDependencies(node.packageJson?.text ?? null, { npmToRepo, localProtocols }),
    ]);

    record.revision = revision;
    record.pages = pages;
    record.manifest = deps.manifest;
    record.dependencies = deps.dependencies;
    if (deps.error) record.errors.push(deps.error);

    if (entry.npm) {
      try {
        record.npm = await packageStatus(entry.npm);
      } catch (error) {
        record.npm = { name: entry.npm, published: false, error: error.message };
        record.errors.push(`npm: ${error.message}`);
      }
    } else {
      record.npm = { name: null, published: false, notAPackage: true };
    }

    // Does what npm serves match the newest tag in the repository?
    const tagName = revision?.tag?.name ?? null;
    const tagVersion = tagName ? semver.coerce(tagName)?.version ?? null : null;
    record.npm.matchesTag =
      record.npm.published && record.npm.latest && tagVersion
        ? semver.eq(record.npm.latest, tagVersion)
        : null;

    return record;
  });

  const report = {
    generatedAt: new Date().toISOString(),
    owner,
    scope: catalog.scope,
    site: catalog.site,
    categories: catalog.categories,
    packages,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`);

  const failed = packages.filter((p) => p.errors.length);
  console.log(`wrote ${OUT}`);
  console.log(
    `${packages.length} packages, ${packages.filter((p) => p.npm?.published).length} on npm, ` +
      `${packages.filter((p) => p.pages?.enabled).length} with Pages, ` +
      `${packages.filter((p) => p.icon).length} with a block icon, ${failed.length} with errors`,
  );
  for (const p of failed) console.warn(`  ${p.repo}: ${p.errors.join('; ')}`);
}

await main();
