#!/usr/bin/env node
/**
 * Renders data/dashboard.json into site/index.html.
 *
 * The page is plain HTML with one inline stylesheet and one small inline
 * script: no framework, no build step, nothing to go stale. Everything that
 * changes lives in the JSON.
 */
import { access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'dashboard.json');
const SITE = join(ROOT, 'site');
const OUT = join(SITE, 'index.html');

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const exists = (path) =>
  access(path, constants.R_OK).then(
    () => true,
    () => false,
  );

function relativeDate(iso) {
  if (!iso) return '';
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #f6f7fb;
  --panel: #ffffff;
  --border: #dfe3ec;
  --text: #1a1d26;
  --muted: #68718a;
  --accent: #3b55e0;
  --ok-bg: #e4f6ec; --ok-fg: #16633a;
  --warn-bg: #fdf0da; --warn-fg: #8a5a09;
  --bad-bg: #fde8e8; --bad-fg: #a02121;
  --idle-bg: #eceff6; --idle-fg: #5b6480;
  --shadow: 0 1px 2px rgba(20, 25, 50, .06), 0 8px 24px rgba(20, 25, 50, .05);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1016;
    --panel: #171a22;
    --border: #272c38;
    --text: #e7eaf2;
    --muted: #949db8;
    --accent: #7f93ff;
    --ok-bg: #11301f; --ok-fg: #6fd79b;
    --warn-bg: #352713; --warn-fg: #f0bb63;
    --bad-bg: #38191b; --bad-fg: #f49a9a;
    --idle-bg: #20242e; --idle-fg: #99a2bb;
    --shadow: none;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.55 system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: 1440px; margin: 0 auto; padding: 0 16px 80px; }

header.hero { padding: 40px 0 24px; display: flex; gap: 20px; align-items: flex-start; }
.hero .mark { width: 66px; height: 66px; flex: none; }
header.hero h1 { margin: 0; font-size: 30px; letter-spacing: -.4px; }
header.hero p { margin: 6px 0 0; color: var(--muted); max-width: 70ch; }
.disclaimer {
  margin-top: 12px; padding: 10px 14px; border-radius: 10px;
  background: var(--idle-bg); color: var(--idle-fg); font-size: 13px; max-width: 80ch;
}

.stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0 8px; }
.stat {
  background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
  padding: 10px 16px; box-shadow: var(--shadow); min-width: 118px;
}
.stat b { display: block; font-size: 24px; line-height: 1.2; }
.stat span { color: var(--muted); font-size: 12px; }

.toolbar {
  position: sticky; top: 0; z-index: 5; margin: 16px 0 24px; padding: 12px 0;
  background: var(--bg); border-bottom: 1px solid var(--border);
  display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center;
}
.toolbar input[type=search] {
  flex: 1 1 240px; min-width: 200px; padding: 8px 12px; font: inherit;
  border: 1px solid var(--border); border-radius: 9px;
  background: var(--panel); color: var(--text);
}
.toolbar label { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: var(--muted); cursor: pointer; }
.legend { font-size: 12px; color: var(--muted); margin-left: auto; }

section { margin-bottom: 36px; }
section > h2 { margin: 0 0 2px; font-size: 19px; }
section > h2 .ja { color: var(--muted); font-weight: 400; font-size: 14px; margin-left: 8px; }
section > p.lead { margin: 0 0 12px; color: var(--muted); font-size: 13px; }

.panel {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 14px; box-shadow: var(--shadow); overflow-x: auto;
}
table { border-collapse: collapse; width: 100%; min-width: 1080px; }
th, td { padding: 10px 12px; text-align: left; vertical-align: top; border-top: 1px solid var(--border); }
thead th {
  border-top: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .6px;
  color: var(--muted); font-weight: 600; white-space: nowrap;
}
tbody tr:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }
td.name { min-width: 230px; }
td.name .pkg { font-weight: 600; }
td.name .desc { color: var(--muted); font-size: 12.5px; margin-top: 2px; max-width: 42ch; }
td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
td.deps { min-width: 280px; }

.tag {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
  border-radius: 999px; font-size: 12px; white-space: nowrap;
  background: var(--idle-bg); color: var(--idle-fg);
}
.tag.ok { background: var(--ok-bg); color: var(--ok-fg); }
.tag.warn { background: var(--warn-bg); color: var(--warn-fg); }
.tag.bad { background: var(--bad-bg); color: var(--bad-fg); }
.muted { color: var(--muted); }
.sub { display: block; font-size: 11.5px; color: var(--muted); margin-top: 3px; }

.thumb {
  display: block; width: 136px; height: 85px; border-radius: 7px;
  border: 1px solid var(--border); object-fit: cover; object-position: top center;
  background: var(--idle-bg);
}

.chips { display: flex; flex-wrap: wrap; gap: 5px; }
.chip {
  font: 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 7px; border-radius: 6px;
  background: var(--idle-bg); color: var(--idle-fg); white-space: nowrap;
}
.chip.family { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.chip.stale { background: var(--warn-bg); color: var(--warn-fg); }
.chip.local { background: var(--bad-bg); color: var(--bad-fg); }
.chip.external[hidden] { display: none; }

footer { color: var(--muted); font-size: 13px; border-top: 1px solid var(--border); padding-top: 18px; }
tr[hidden], section[hidden] { display: none; }
`;

const SCRIPT = `
const search = document.getElementById('q');
const filters = [...document.querySelectorAll('[data-filter]')];
const showExternal = document.getElementById('external');

function apply() {
  const needle = search.value.trim().toLowerCase();
  const active = filters.filter((f) => f.checked).map((f) => f.dataset.filter);

  for (const section of document.querySelectorAll('section[data-category]')) {
    let shown = 0;
    for (const row of section.querySelectorAll('tbody tr')) {
      const haystack = row.dataset.search;
      const flags = row.dataset.flags.split(' ');
      const visible =
        (!needle || haystack.includes(needle)) &&
        active.every((flag) => flags.includes(flag));
      row.hidden = !visible;
      if (visible) shown++;
    }
    section.hidden = shown === 0;
  }
}

for (const chip of document.querySelectorAll('.chip.external')) {
  chip.hidden = true;
}
showExternal.addEventListener('change', () => {
  for (const chip of document.querySelectorAll('.chip.external')) {
    chip.hidden = !showExternal.checked;
  }
});
search.addEventListener('input', apply);
for (const f of filters) f.addEventListener('change', apply);
`;

function issuesCell(pkg) {
  const count = pkg.github?.openIssues ?? 0;
  const href = `${pkg.github?.url}/issues`;
  if (!count) return '<span class="muted">0</span>';
  return `<a class="tag warn" href="${esc(href)}">${count}</a>`;
}

function pullsCell(pkg) {
  const count = pkg.github?.openPullRequests ?? 0;
  const href = `${pkg.github?.url}/pulls`;
  if (!count) return '<span class="muted">0</span>';
  return `<a class="tag warn" href="${esc(href)}">${count}</a>`;
}

function revisionCell(pkg) {
  const rev = pkg.revision;
  if (!rev || rev.state === 'empty') return '<span class="muted">—</span>';

  const tag = rev.tag?.name ? esc(rev.tag.name) : null;
  if (rev.state === 'untagged') {
    return `<span class="tag">untagged</span><span class="sub">${relativeDate(rev.head?.committedDate)}</span>`;
  }
  if (rev.state === 'released') {
    return `<span class="tag ok">${tag}</span><span class="sub">tip is tagged</span>`;
  }
  const ahead = rev.aheadBy == null ? 'ahead' : `${rev.aheadBy} ahead`;
  return `<span class="tag warn">${ahead}</span><span class="sub">since ${tag} · ${relativeDate(rev.head?.committedDate)}</span>`;
}

function pagesCell(pkg, thumb) {
  const pages = pkg.pages;
  if (!pages?.enabled) return '<span class="muted">—</span>';

  const url = pages.url ?? pkg.github?.homepageUrl;
  // GitHub only reports `status` for legacy builds; for workflow-deployed
  // sites we go by whether the site actually answered when we asked.
  const status =
    pages.status ?? (pages.live === true ? 'live' : pages.live === false ? 'down' : 'unknown');
  const badgeClass =
    status === 'built' || status === 'live'
      ? 'ok'
      : status === 'errored' || status === 'down'
        ? 'bad'
        : 'warn';

  if (!url) return `<span class="tag ${badgeClass}">${esc(status)}</span>`;

  const badge = `<a class="tag ${badgeClass}" href="${esc(url)}">${esc(status)}</a>`;
  if (!thumb) return badge;

  return `<a href="${esc(url)}"><img class="thumb" loading="lazy" src="${esc(thumb)}" alt="${esc(pkg.repo)} home page"></a>${badge}`;
}

function npmCell(pkg) {
  const npm = pkg.npm ?? {};
  if (npm.notAPackage) return '<span class="muted">—<span class="sub">not published</span></span>';
  if (!npm.published) return '<span class="tag bad">unpublished</span>';

  const href = `https://www.npmjs.com/package/${npm.name}`;
  const parts = [`<a class="tag ok" href="${esc(href)}">${esc(npm.latest ?? '?')}</a>`];
  if (npm.deprecated) parts.push('<span class="tag bad">deprecated</span>');
  if (npm.matchesTag === false) {
    parts.push(`<span class="sub">⚠️ tag ${esc(pkg.revision?.tag?.name ?? '')} ≠ npm</span>`);
  } else {
    parts.push(`<span class="sub">${relativeDate(npm.lastPublishedAt)}</span>`);
  }
  return parts.join(' ');
}

function depsCell(pkg) {
  const deps = pkg.dependencies ?? [];
  if (!deps.length) return '<span class="muted">—</span>';

  const order = { prod: 0, peer: 1, optional: 2, dev: 3 };
  const chips = [...deps]
    .sort((a, b) => Number(b.family) - Number(a.family) || order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
    .map((dep) => {
      const classes = ['chip'];
      if (dep.local) classes.push('local');
      else if (dep.stale) classes.push('stale');
      else if (dep.family) classes.push('family');
      else classes.push('external');

      const short = dep.name.startsWith('@') ? dep.name.split('/')[1] : dep.name;
      const mark = dep.local ? '💀' : dep.stale ? '⚠️' : '';
      const title = [
        dep.name,
        `range ${dep.range}`,
        dep.latest ? `latest ${dep.latest}` : null,
        dep.local ? 'local reference' : null,
        dep.stale ? `stale: ${dep.latest} is outside the range` : null,
        dep.missing ? 'not on the registry' : null,
        `(${dep.kind})`,
      ]
        .filter(Boolean)
        .join(' · ');

      return `<span class="${classes.join(' ')}" title="${esc(title)}">${esc(short)}@${esc(dep.range)}${mark}</span>`;
    });

  return `<div class="chips">${chips.join('')}</div>`;
}

function flagsFor(pkg) {
  const flags = [];
  if ((pkg.github?.openIssues ?? 0) > 0) flags.push('issues');
  if ((pkg.github?.openPullRequests ?? 0) > 0) flags.push('prs');
  if (pkg.revision?.state === 'unreleased') flags.push('unreleased');
  if (pkg.npm && !pkg.npm.published && !pkg.npm.notAPackage) flags.push('unpublished');
  if (pkg.pages?.enabled) flags.push('pages');
  if (pkg.dependencies?.some((d) => d.stale && d.family)) flags.push('stale-family');
  if (pkg.dependencies?.some((d) => d.stale && !d.family)) flags.push('stale-external');
  if (pkg.dependencies?.some((d) => d.local)) flags.push('local');
  return flags;
}

function row(pkg, thumb) {
  const gh = pkg.github ?? {};
  const haystack = [pkg.repo, pkg.npm?.name, gh.description, pkg.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const archived = gh.isArchived ? ' <span class="tag">archived</span>' : '';
  const note = pkg.note ? `<span class="sub">${esc(pkg.note)}</span>` : '';

  return `<tr data-search="${esc(haystack)}" data-flags="${esc(flagsFor(pkg).join(' '))}">
  <td class="name">
    <div class="pkg"><a href="${esc(gh.url ?? '#')}">${esc(pkg.label)}</a>${archived}</div>
    <div class="desc">${esc(gh.description ?? '')}</div>
    ${note}
  </td>
  <td class="num">${issuesCell(pkg)}</td>
  <td class="num">${pullsCell(pkg)}</td>
  <td>${revisionCell(pkg)}</td>
  <td>${pagesCell(pkg, thumb)}</td>
  <td>${npmCell(pkg)}</td>
  <td class="deps">${depsCell(pkg)}</td>
</tr>`;
}

async function main() {
  const report = JSON.parse(await readFile(DATA, 'utf8'));

  const thumbs = new Map(
    await Promise.all(
      report.packages.map(async (pkg) => {
        const file = `thumbs/${pkg.repo}.png`;
        return [pkg.repo, (await exists(join(SITE, file))) ? file : null];
      }),
    ),
  );

  const byCategory = new Map(report.categories.map((c) => [c.id, []]));
  for (const pkg of report.packages) {
    byCategory.get(pkg.category)?.push(pkg);
  }

  const sections = report.categories
    .map((category) => {
      const packages = byCategory.get(category.id) ?? [];
      if (!packages.length) return '';
      const rows = packages.map((pkg) => row(pkg, thumbs.get(pkg.repo))).join('\n');
      return `<section data-category="${esc(category.id)}">
  <h2>${esc(category.title)}${category.titleJa ? `<span class="ja">${esc(category.titleJa)}</span>` : ''}</h2>
  ${category.description ? `<p class="lead">${esc(category.description)}</p>` : ''}
  <div class="panel"><table>
    <thead><tr>
      <th>Package</th><th>Issues</th><th>PRs</th><th>Revision</th>
      <th>GitHub&nbsp;Pages</th><th>npm</th><th>Upstream dependencies</th>
    </tr></thead>
    <tbody>
${rows}
    </tbody>
  </table></div>
</section>`;
    })
    .join('\n');

  const total = report.packages.length;
  const onNpm = report.packages.filter((p) => p.npm?.published).length;
  const withPages = report.packages.filter((p) => p.pages?.enabled).length;
  const openIssues = report.packages.reduce((sum, p) => sum + (p.github?.openIssues ?? 0), 0);
  const openPulls = report.packages.reduce((sum, p) => sum + (p.github?.openPullRequests ?? 0), 0);
  const unreleased = report.packages.filter((p) => p.revision?.state === 'unreleased').length;
  const staleFamily = report.packages.filter((p) =>
    p.dependencies?.some((d) => d.stale && d.family),
  ).length;
  const staleExternal = report.packages.filter((p) =>
    p.dependencies?.some((d) => d.stale && !d.family),
  ).length;
  const localDeps = report.packages.filter((p) => p.dependencies?.some((d) => d.local)).length;

  const site = report.site ?? {};
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.title ?? 'Packages')}</title>
<meta name="description" content="${esc(site.tagline ?? '')}">
<link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<meta property="og:title" content="${esc(site.title ?? '')}">
<meta property="og:description" content="${esc(site.tagline ?? '')}">
<meta property="og:image" content="assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header class="hero">
  <img class="mark" src="assets/icon.svg" alt="">
  <div>
    <h1>${esc(site.title ?? 'Packages')}</h1>
    <p>${esc(site.tagline ?? '')}</p>
    ${site.disclaimer ? `<div class="disclaimer">${esc(site.disclaimer)}</div>` : ''}
  </div>
</header>

<div class="stats">
  <div class="stat"><b>${total}</b><span>packages</span></div>
  <div class="stat"><b>${onNpm}</b><span>published on npm</span></div>
  <div class="stat"><b>${withPages}</b><span>with GitHub Pages</span></div>
  <div class="stat"><b>${openIssues}</b><span>open issues</span></div>
  <div class="stat"><b>${openPulls}</b><span>open pull requests</span></div>
  <div class="stat"><b>${unreleased}</b><span>unreleased commits</span></div>
  <div class="stat"><b>${staleFamily}</b><span>behind our own upstreams</span></div>
  <div class="stat"><b>${staleExternal}</b><span>behind third-party upstreams</span></div>
  <div class="stat"><b>${localDeps}</b><span>with local upstreams</span></div>
</div>

<div class="toolbar">
  <input id="q" type="search" placeholder="Filter by name or description…" autocomplete="off">
  <label><input type="checkbox" data-filter="issues"> open issues</label>
  <label><input type="checkbox" data-filter="unreleased"> unreleased</label>
  <label><input type="checkbox" data-filter="unpublished"> not on npm</label>
  <label><input type="checkbox" data-filter="stale-family"> stale (ours)</label>
  <label><input type="checkbox" data-filter="stale-external"> stale (third-party)</label>
  <label><input type="checkbox" data-filter="local"> local upstream</label>
  <label><input type="checkbox" id="external"> show external deps</label>
  <span class="legend">💀 local reference · ⚠️ stale range</span>
</div>

${sections}

<footer>
  Generated ${esc(report.generatedAt)} ·
  <a href="${esc(site.repoUrl ?? '#')}">source</a> ·
  <a href="${esc(site.repoUrl ?? '#')}/blob/main/catalog.yaml">catalog.yaml</a>
</footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;

  await writeFile(OUT, html);
  console.log(`wrote ${OUT} (${total} packages in ${report.categories.length} categories)`);
}

await main();
