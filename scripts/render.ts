#!/usr/bin/env -S npx tsx
/**
 * Renders data/dashboard.json into site/index.html.
 *
 * The page is plain HTML with one inline stylesheet and one small inline
 * script: no framework, no build step, nothing to go stale. Everything that
 * changes lives in the JSON.
 *
 * It carries both languages at once. Every translated string is emitted twice,
 * tagged with its own `lang`, and the stylesheet hides whichever does not match
 * `<html lang>`. Switching is then one attribute write: no re-render, no second
 * page to keep in step, and the page still reads correctly with scripting off.
 */
import { access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DashboardPackage, DashboardReport, GitHubSummary, NpmStatus } from './lib/types.ts';

interface Thumbnail {
  light: string | null;
  dark: string | null;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'dashboard.json');
const SITE = join(ROOT, 'site');
const OUT = join(SITE, 'index.html');

/**
 * The shared header every documentation site in this family loads. Served from
 * its own repository so that a change there reaches every site, this one
 * included, without editing any of them.
 */
const DEFAULT_HEADER_SCRIPT =
  'https://kubohiroya.github.io/turbowarp-plus-site-header/dist/auto.js';
const DEFAULT_DEMO_EDITOR = 'https://kubohiroya.github.io/turbowarp-plus-editor/editor.html';
const EDITOR_BRAND_ICON = 'https://kubohiroya.github.io/turbowarp-plus-editor/assets/icon.svg';

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** One phrase in both languages; the stylesheet shows the active one. */
const t = (en: string, ja: string) => `<span lang="en">${en}</span><span lang="ja">${ja}</span>`;

const exists = (path: string) =>
  access(path, constants.R_OK).then(
    () => true,
    () => false,
  );

function relativeDate(iso: string | null | undefined) {
  if (!iso) return '';
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return t('today', '今日');
  if (days === 1) return t('yesterday', '昨日');
  if (days < 30) return t(`${days}d ago`, `${days}日前`);
  if (days < 365) {
    const months = Math.round(days / 30);
    return t(`${months}mo ago`, `${months}か月前`);
  }
  const years = Math.round(days / 365);
  return t(`${years}y ago`, `${years}年前`);
}

const DARK_PALETTE = `
  color-scheme: dark;
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
  --demo-bg: #173d54; --demo-fg: #d8f1ff;
  --demo-border: #497f9e; --demo-hover: #20516f;
`;

const STYLE = `
:root {
  color-scheme: light;
  --bg: #f6f7fb;
  --panel: #ffffff;
  --border: #dfe3ec;
  --text: #1a1d26;
  --muted: #68718a;
  --accent: #3b55e0;
  --demo-bg: #ddf4ff; --demo-fg: #132e42;
  --demo-border: #83bfd9; --demo-hover: #c8edff;
  --ok-bg: #e4f6ec; --ok-fg: #16633a;
  --warn-bg: #fdf0da; --warn-fg: #8a5a09;
  --bad-bg: #fde8e8; --bad-fg: #a02121;
  --idle-bg: #eceff6; --idle-fg: #5b6480;
  --shadow: 0 1px 2px rgba(20, 25, 50, .06), 0 8px 24px rgba(20, 25, 50, .05);
}
:root[data-theme="dark"] { ${DARK_PALETTE} }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]) { ${DARK_PALETTE} }
}

/* Only the phrases matching <html lang> are shown. */
html[lang="en"] [lang="ja"],
html[lang="ja"] [lang="en"] { display: none; }

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
.stat span.label { color: var(--muted); font-size: 12px; }

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
html[lang="ja"] thead th { text-transform: none; letter-spacing: 0; font-size: 12px; }
tbody tr:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }
td.name { min-width: 230px; }
td.name .pkg { font-weight: 600; display: flex; align-items: center; gap: 7px; }
/* Show the app's favicon or the extension's palette icon at the same size. */
td.name .pkg .icon { flex: 0 0 auto; width: 20px; height: 20px; }
td.name .pkg img.icon { object-fit: contain; }
td.name .pkg .icon svg { width: 100%; height: 100%; display: block; }
.sandbox-status { margin: 5px 0 0 27px; }
td.name .desc {
  color: var(--muted); font-size: 12.5px; margin-top: 2px; max-width: 42ch;
  /* Indented to clear the icon, so the summary lines up with the name. */
  padding-left: 27px;
  /* Summaries come from READMEs and vary in length; bound the row without
     cutting the text out of the document. */
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4;
  overflow: hidden;
}
td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
td.demo { text-align: center; }
.demo-play {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; min-height: 36px; padding: 5px 9px; border: 1px solid var(--demo-border); border-radius: 8px;
  background: var(--demo-bg); color: var(--demo-fg); font-size: 14px; font-weight: 600;
  text-align: left; line-height: 1.4; white-space: nowrap;
}
.demo-play img { width: 24px; height: 24px; flex: none; object-fit: contain; }
.demo-play:hover { background: var(--demo-hover); color: var(--demo-fg); text-decoration: none; }
.demo-play:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
td.deps { min-width: 280px; }
td.npm { min-width: 150px; }

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

picture { display: block; }
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

/** Chooses the language before first paint, so the page never flashes. */
const EARLY_SCRIPT = `
try {
  var saved = localStorage.getItem('lang');
  document.documentElement.lang =
    saved || ((navigator.language || 'en').toLowerCase().startsWith('ja') ? 'ja' : 'en');
} catch (e) {}
`;

const SCRIPT = `
const search = document.getElementById('q');
const filters = [...document.querySelectorAll('[data-filter]')];
const showExternal = document.getElementById('external');
// The language switch lives in the shared header, which reports presses.
const header = document.querySelector('turbowarp-plus-header');

const PLACEHOLDER = {
  en: 'Filter by name or description…',
  ja: '名前や説明で絞り込み…',
};

function setLang(lang) {
  document.documentElement.lang = lang;
  search.placeholder = PLACEHOLDER[lang];
  for (const button of document.querySelectorAll('.demo-play')) {
    button.title = lang === 'ja' ? 'TurboWarp-Plus-Editorで編集' : 'Edit in TurboWarp-Plus-Editor';
  }
  if (header) header.setAttribute('site-lang', lang);
  try { localStorage.setItem('lang', lang); } catch (e) {}
}

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
document.addEventListener('turbowarp-plus:language', (event) => {
  setLang(event.detail.lang);
});

setLang(document.documentElement.lang === 'ja' ? 'ja' : 'en');
`;

function demoCell(pkg: DashboardPackage, editorUrl: string) {
  const empty = '<span class="muted">—</span>';
  if (!pkg.demo) return empty;
  let editor: URL;
  try {
    const project = new URL(pkg.demo.projectUrl);
    editor = new URL(editorUrl);
    if (project.protocol !== 'https:' || editor.protocol !== 'https:') return empty;
    editor.searchParams.set('project_url', project.href);
    editor.searchParams.set('project_title', pkg.demo.title);
  } catch {
    return empty;
  }
  const label = esc(`${pkg.label}: ${pkg.demo.title}`);
  return `<a class="demo-play twpe-edit-button twpe-edit-button--small" href="${esc(editor.href)}" target="_blank" rel="noopener noreferrer" title="Edit in TurboWarp-Plus-Editor">
    <img src="${EDITOR_BRAND_ICON}" alt="" width="24" height="24">
    <span>${t('Edit', '編集')}</span>
    <span class="sr-only">${t(` in TurboWarp-Plus-Editor: ${label} (new tab)`, `：TurboWarp-Plus-Editorで編集：${label}（新しいタブ）`)}</span>
  </a>`;
}

function issuesCell(pkg: DashboardPackage) {
  const count = pkg.github?.openIssues ?? 0;
  if (!count) return '<span class="muted">0</span>';
  return `<a class="tag warn" href="${esc(`${pkg.github?.url}/issues`)}">${count}</a>`;
}

function pullsCell(pkg: DashboardPackage) {
  const count = pkg.github?.openPullRequests ?? 0;
  if (!count) return '<span class="muted">0</span>';
  return `<a class="tag warn" href="${esc(`${pkg.github?.url}/pulls`)}">${count}</a>`;
}

function revisionCell(pkg: DashboardPackage) {
  const rev = pkg.revision;
  if (!rev || rev.state === 'empty') return '<span class="muted">—</span>';

  const tag = rev.tag?.name ? esc(rev.tag.name) : '';
  const when = relativeDate(rev.head?.committedDate);

  if (rev.state === 'untagged') {
    return `<span class="tag">${t('untagged', 'タグなし')}</span><span class="sub">${when}</span>`;
  }
  if (rev.state === 'released') {
    return `<span class="tag ok">${tag}</span><span class="sub">${t('tip is tagged', '先頭にタグあり')}</span>`;
  }

  const ahead =
    rev.aheadBy == null
      ? t('ahead', '先行')
      : t(`${rev.aheadBy} ahead`, `${rev.aheadBy} コミット先行`);
  return `<span class="tag warn">${ahead}</span><span class="sub">${t(`since ${tag}`, `${tag} 以降`)} · ${when}</span>`;
}

const PAGES_LABEL: Record<string, [string, string]> = {
  live: ['live', '公開中'],
  built: ['built', 'ビルド済'],
  building: ['building', 'ビルド中'],
  errored: ['errored', 'エラー'],
  down: ['down', '応答なし'],
  unknown: ['unknown', '不明'],
};

function pagesCell(pkg: DashboardPackage, thumb: Thumbnail | undefined) {
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
  const [en, ja] = PAGES_LABEL[status] ?? [status, status];
  const label = t(esc(en), esc(ja));

  if (!url) return `<span class="tag ${badgeClass}">${label}</span>`;

  const badge = `<a class="tag ${badgeClass}" href="${esc(url)}">${label}</a>`;
  if (!thumb?.light) return badge;

  const alt = `${pkg.repo} home page`;
  // The dashboard follows prefers-color-scheme, so the thumbnail does too: a
  // light screenshot on a dark page reads as a hole in the table. <picture>
  // does the switch natively, with no script and no second request.
  const darkSource = thumb.dark
    ? `<source media="(prefers-color-scheme: dark)" srcset="${esc(thumb.dark)}">`
    : '';
  return `<a href="${esc(url)}"><picture>${darkSource}<img class="thumb" loading="lazy" src="${esc(thumb.light)}" alt="${esc(alt)}"></picture></a>${badge}`;
}

function npmCell(pkg: DashboardPackage) {
  const npm: Partial<NpmStatus> = pkg.npm ?? {};
  if (npm.notAPackage) {
    return `<span class="muted">—<span class="sub">${t('not an npm package', 'npm 対象外')}</span></span>`;
  }
  if (!npm.published) {
    return `<span class="tag bad">${t('unpublished', '未公開')}</span>`;
  }

  const href = `https://www.npmjs.com/package/${npm.name}`;
  const parts = [`<a class="tag ok" href="${esc(href)}">${esc(npm.latest ?? '?')}</a>`];
  if (npm.deprecated) parts.push(`<span class="tag bad">${t('deprecated', '非推奨')}</span>`);

  if (npm.matchesTag === false) {
    const tag = esc(pkg.revision?.tag?.name ?? '');
    parts.push(
      `<span class="sub">⚠️ ${t(`tag ${tag} ≠ npm`, `タグ ${tag} ≠ npm`)}</span>`,
    );
  } else {
    parts.push(`<span class="sub">${relativeDate(npm.lastPublishedAt)}</span>`);
  }
  return parts.join(' ');
}

function depsCell(pkg: DashboardPackage) {
  const deps = pkg.dependencies ?? [];
  if (!deps.length) return '<span class="muted">—</span>';

  const order = { prod: 0, peer: 1, optional: 2, dev: 3 };
  const chips = [...deps]
    .sort(
      (a, b) =>
        Number(b.family) - Number(a.family) ||
        order[a.kind] - order[b.kind] ||
        a.name.localeCompare(b.name),
    )
    .map((dep) => {
      const classes = ['chip'];
      if (dep.local) classes.push('local');
      else if (dep.stale) classes.push('stale');
      else if (dep.family) classes.push('family');
      else classes.push('external');

      const short = dep.name.startsWith('@') ? dep.name.split('/')[1] : dep.name;
      const mark = dep.local ? '💀' : dep.stale ? '⚠️' : '';
      // A tooltip cannot hold two languages, so this one is built from the
      // names and numbers themselves rather than from sentences.
      const title = [
        dep.name,
        dep.range,
        dep.latest && dep.latest !== dep.wanted ? `→ ${dep.latest}` : null,
        `(${dep.kind})`,
        dep.local ? '💀' : null,
        dep.stale ? '⚠️' : null,
        dep.missing ? '404' : null,
      ]
        .filter(Boolean)
        .join(' ');

      const href = `https://www.npmjs.com/package/${dep.name}`;
      return `<a class="${classes.join(' ')}" href="${esc(href)}" title="${esc(title)}">${esc(short)}@${esc(dep.range)}${mark}</a>`;
    });

  return `<div class="chips">${chips.join('')}</div>`;
}

function flagsFor(pkg: DashboardPackage) {
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

function sandboxBadge(pkg: DashboardPackage) {
  const inherited = pkg.unsandboxedRequiredBy?.length
    ? pkg.unsandboxedRequiredBy : undefined;
  const requirement = inherited ? 'required' : pkg.unsandboxed;
  if (!requirement) return '';
  const labels = {
    required: ['warn', '🔓', 'Without sandbox: required', 'サンドボックスなし：必須'],
    optional: ['idle', '◐', 'Without sandbox: optional', 'サンドボックスなし：任意'],
    'not-needed': ['ok', '🛡', 'Without sandbox: not needed', 'サンドボックスなし：不要'],
    unknown: ['idle', '?', 'Without sandbox: unknown', 'サンドボックスなし：不明'],
  } as const;
  const [style, icon, en, ja] = labels[requirement] ?? labels.unknown;
  const title = inherited ? ` title="${esc(inherited.join(', '))}"` : '';
  return `<div class="sandbox-status"><span class="tag ${style}"${title}><span aria-hidden="true">${icon}</span>${t(en, ja)}</span></div>`;
}

function row(pkg: DashboardPackage, thumb: Thumbnail | undefined, editorUrl: string) {
  const gh: Partial<GitHubSummary> = pkg.github ?? {};
  const { en = '', ja = '' } = pkg.descriptions ?? {};

  // Both languages are searchable whichever one is on screen.
  const haystack = [pkg.repo, pkg.npm?.name, en, ja, pkg.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const archived = gh.isArchived ? ` <span class="tag">${t('archived', 'アーカイブ')}</span>` : '';
  // Favicons stay in an image context; only vetted palette drawings are inlined.
  const favicon = pkg.category === 'apps' ? pkg.pages?.svgFaviconUrl ?? pkg.pages?.faviconUrl : null;
  const icon = favicon
    ? `<img class="icon" src="${esc(favicon)}" alt="" width="20" height="20">`
    : pkg.icon ? `<span class="icon" aria-hidden="true">${pkg.icon}</span>` : '';
  const note = pkg.note ? `<span class="sub">${esc(pkg.note)}</span>` : '';
  // With no Japanese summary the English one stands in, untagged, so it shows
  // in both languages rather than leaving an empty cell.
  const summary = ja && ja !== en ? t(esc(en), esc(ja)) : esc(en);

  return `<tr data-search="${esc(haystack)}" data-flags="${esc(flagsFor(pkg).join(' '))}">
  <td class="name">
    <div class="pkg">${icon}<a href="${esc(gh.url ?? '#')}">${esc(pkg.label)}</a>${archived}</div>
    <div class="desc">${summary}</div>
    ${sandboxBadge(pkg)}
    ${note}
  </td>
  <td class="demo">${demoCell(pkg, editorUrl)}</td>
  <td class="num">${issuesCell(pkg)}</td>
  <td class="num">${pullsCell(pkg)}</td>
  <td>${revisionCell(pkg)}</td>
  <td>${pagesCell(pkg, thumb)}</td>
  <td class="npm">${npmCell(pkg)}</td>
  <td class="deps">${depsCell(pkg)}</td>
</tr>`;
}

const HEADERS = [
  ['Package', 'パッケージ'],
  ['Demo', 'Demo'],
  ['Issues', 'Issue'],
  ['PRs', 'PR'],
  ['Revision', 'リビジョン'],
  ['GitHub&nbsp;Pages', 'GitHub&nbsp;Pages'],
  ['npm', 'npm'],
  ['Upstream dependencies', '上流依存'],
];

const STAT_LABELS = [
  ['packages', 'パッケージ'],
  ['published on npm', 'npm 公開済み'],
  ['with GitHub Pages', 'Pages あり'],
  ['open issues', '未クローズ issue'],
  ['open pull requests', '未クローズ PR'],
  ['unreleased commits', '未リリースあり'],
  ['behind our own upstreams', '自前上流が stale'],
  ['behind third-party upstreams', '他社上流が stale'],
  ['with local upstreams', 'ローカル参照あり'],
];

const FILTERS = [
  ['issues', 'open issues', 'issue あり'],
  ['unreleased', 'unreleased', '未リリース'],
  ['unpublished', 'not on npm', 'npm 未公開'],
  ['stale-family', 'stale (ours)', 'stale（自前）'],
  ['stale-external', 'stale (third-party)', 'stale（他社）'],
  ['local', 'local upstream', 'ローカル参照'],
];

async function main() {
  const report = JSON.parse(await readFile(DATA, 'utf8')) as DashboardReport;
  // Keep collected metadata for planning, but omit deprecated rows and totals.
  report.packages = report.packages.filter((pkg) => !pkg.npm?.deprecated);

  // A site without dark mode produces two identical shots, so thumbnails.ts
  // keeps only the light one and `dark` stays null here.
  const thumbs = new Map(
    await Promise.all(
      report.packages.map(async (pkg): Promise<[string, Thumbnail]> => {
        const light = `thumbs/${pkg.repo}.light.png`;
        const dark = `thumbs/${pkg.repo}.dark.png`;
        return [
          pkg.repo,
          {
            light: (await exists(join(SITE, light))) ? light : null,
            dark: (await exists(join(SITE, dark))) ? dark : null,
          },
        ];
      }),
    ),
  );

  const byCategory = new Map<string, DashboardPackage[]>(report.categories.map((c) => [c.id, []]));
  for (const pkg of report.packages) {
    byCategory.get(pkg.category)?.push(pkg);
  }

  const head = HEADERS.map(([en, ja]) => `<th>${t(en, ja)}</th>`).join('');

  const sections = report.categories
    .map((category) => {
      const packages = byCategory.get(category.id) ?? [];
      if (!packages.length) return '';

      const rows = packages.map((pkg) => row(pkg, thumbs.get(pkg.repo), report.site?.demoEditorUrl ?? DEFAULT_DEMO_EDITOR)).join('\n');
      const heading = t(esc(category.title), esc(category.titleJa ?? category.title));
      const lead = category.description
        ? `<p class="lead">${t(esc(category.description), esc(category.descriptionJa ?? category.description))}</p>`
        : '';

      return `<section data-category="${esc(category.id)}">
  <h2>${heading}</h2>
  ${lead}
  <div class="panel"><table>
    <thead><tr>${head}</tr></thead>
    <tbody>
${rows}
    </tbody>
  </table></div>
</section>`;
    })
    .join('\n');

  const counts = [
    report.packages.length,
    report.packages.filter((p) => p.npm?.published).length,
    report.packages.filter((p) => p.pages?.enabled).length,
    report.packages.reduce((sum, p) => sum + (p.github?.openIssues ?? 0), 0),
    report.packages.reduce((sum, p) => sum + (p.github?.openPullRequests ?? 0), 0),
    report.packages.filter((p) => p.revision?.state === 'unreleased').length,
    report.packages.filter((p) => p.dependencies?.some((d) => d.stale && d.family)).length,
    report.packages.filter((p) => p.dependencies?.some((d) => d.stale && !d.family)).length,
    report.packages.filter((p) => p.dependencies?.some((d) => d.local)).length,
  ];

  const stats = STAT_LABELS.map(
    ([en, ja], i) =>
      `  <div class="stat"><b>${counts[i]}</b><span class="label">${t(en, ja)}</span></div>`,
  ).join('\n');

  const filterBoxes = FILTERS.map(
    ([flag, en, ja]) =>
      `  <label><input type="checkbox" data-filter="${flag}"> ${t(en, ja)}</label>`,
  ).join('\n');

  const site = report.site ?? {};
  const generated = esc(report.generatedAt);
  const repoUrl = esc(site.repoUrl ?? '#');

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
<script>${EARLY_SCRIPT}</script>
<style>${STYLE}</style>
</head>
<body>
<!-- The family bar, the same one every package's documentation site carries.
     It is placed here rather than left to the script so that it does not
     become sticky: on this page the filter toolbar is what should stay in
     view. npm="none" because this repository is the index, not a package. -->
<turbowarp-plus-header repo="turbowarp-plus-packages" npm="none" lang-switch="buttons"></turbowarp-plus-header>
<div class="wrap">
<header class="hero">
  <img class="mark" src="assets/icon.svg" alt="">
  <div>
    <h1>${esc(site.title ?? 'Packages')}</h1>
    <p>${t(esc(site.tagline ?? ''), esc(site.taglineJa ?? site.tagline ?? ''))}</p>
    ${
      site.disclaimer
        ? `<div class="disclaimer">${t(esc(site.disclaimer), esc(site.disclaimerJa ?? site.disclaimer))}</div>`
        : ''
    }
  </div>
</header>

<div class="stats">
${stats}
</div>

<div class="toolbar">
  <input id="q" type="search" placeholder="Filter by name or description…" autocomplete="off">
${filterBoxes}
  <label><input type="checkbox" id="external"> ${t('show external deps', '他社依存も表示')}</label>
  <span class="legend">${t('💀 local reference · ⚠️ stale range', '💀 ローカル参照 ・ ⚠️ stale')}</span>
</div>

${sections}

<footer>
  ${t(`Generated ${generated}`, `生成 ${generated}`)} ·
  <a href="${repoUrl}">${t('source', 'ソース')}</a> ·
  <a href="${repoUrl}/blob/main/catalog.yaml">catalog.yaml</a>
</footer>
</div>
<script>${SCRIPT}</script>
<script type="module" src="${esc(site.headerScript ?? DEFAULT_HEADER_SCRIPT)}"></script>
</body>
</html>
`;

  await writeFile(OUT, html);
  console.log(
    `wrote ${OUT} (${report.packages.length} packages in ${report.categories.length} categories, en/ja)`,
  );
}

await main();
