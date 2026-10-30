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
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DashboardPackage, DashboardReport, GitHubSummary, NpmStatus } from './lib/types.ts';
import { categoryRelationships } from './lib/relationships.ts';

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
  --demo-bg: #173d54; --demo-fg: #f2f2f2;
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
  background: var(--demo-bg); color: var(--demo-fg); font-size: 14px; font-weight: 400;
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

.graph-panel { padding: 12px; }
.relationship-svg { display: block; width: 100%; min-width: 1000px; color: var(--text); }
.category-boundary { fill: var(--idle-bg); stroke: var(--border); stroke-width: 2; }
.graph-node rect { fill: var(--panel); stroke: var(--accent); stroke-width: 1.5; }
.graph-node.external { opacity: .7; }
.graph-node.external rect { stroke-dasharray: 5 4; }
.node-label { font: 12px/1.3 system-ui, sans-serif; overflow-wrap: anywhere; padding: 9px 12px; color: var(--text); }
.node-label strong { display: block; font-size: 12px; }
.node-label small { display: block; margin-top: 5px; font-size: 10px; }
.graph-node a:hover rect, .graph-node a:focus-visible rect { stroke-width: 3; }
.graph-edge { fill: none; stroke: var(--accent); stroke-width: 1.5; }
.graph-edge.development { stroke: var(--muted); stroke-dasharray: 3 4; }
.development-toggle { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; }
.graph-edge.aggregate { stroke: var(--muted); stroke-width: 2; stroke-dasharray: 6 5; }
.graph-text { fill: var(--text); font: 12px system-ui, sans-serif; }
.edge-count { fill: var(--panel); stroke: var(--border); }
.relationship-details { margin: 14px 0; font-size: 13px; }
.relationship-details summary { cursor: pointer; color: var(--accent); }
.relationship-details ul { padding-left: 22px; overflow-wrap: anywhere; }
.relationship-details li { margin: 5px 0; }
.relation-note { font-size: 12px; color: var(--muted); }
dialog.relationship-dialog {
  width: min(1200px, 94vw); max-height: 92dvh; padding: 0;
  overflow: auto; overscroll-behavior: contain;
  border: 1px solid var(--border); border-radius: 16px;
  background: var(--bg); color: var(--text); box-shadow: var(--shadow);
}
dialog::backdrop { background: rgba(10, 15, 30, .58); }
html.modal-open { overflow: hidden; scrollbar-gutter: stable; }
.dialog-toolbar {
  position: sticky; top: 0; z-index: 10; display: flex; align-items: center;
  justify-content: space-between; gap: 12px; padding: 12px 18px;
  background: var(--panel); border-bottom: 1px solid var(--border);
}
.dialog-category { display: inline-block; max-width: 100%; }
.dialog-toolbar h2 { margin: 0; font-size: 17px; line-height: 1.4; overflow-wrap: anywhere; }
.dialog-close { flex: none; white-space: nowrap; font: inherit; padding: 7px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); color: var(--text); cursor: pointer; }
.dialog-body { padding: 18px; }
.dialog-body section { margin-bottom: 0; }
.dialog-body h3 { margin: 0 0 4px; font-size: 21px; }
.graph-secondary { margin-top: 18px; border-top: 1px solid var(--border); padding-top: 14px; }
.graph-secondary > p { font-size: 13px; margin: 6px 0; }
.graph-help { font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.category-heading { display: flex; gap: 10px; align-items: center; margin-bottom: 4px; }
.category-heading h3 { margin: 0; font-size: 19px; }
.category-graph {
  display: inline-flex; justify-content: center; align-items: center; flex: none;
  width: 36px; height: 36px; padding: 7px; cursor: pointer; color: var(--accent);
  background: var(--panel); border: 1px solid var(--border); border-radius: 9px;
}
.category-graph:hover { background: var(--idle-bg); border-color: var(--accent); }
.category-graph svg { width: 20px; height: 20px; }

footer { color: var(--muted); font-size: 13px; border-top: 1px solid var(--border); padding-top: 18px; }
tr[hidden], section[hidden] { display: none; }

a:focus-visible, button:focus-visible, select:focus-visible, summary:focus-visible {
  outline: 3px solid var(--accent); outline-offset: 3px;
}
.main-content > h2 { font-size: 25px; margin: 0 0 8px; }
.main-content > section > h3 { font-size: 19px; margin: 0 0 2px; }
.main-content > section > p.lead { margin: 0 0 12px; color: var(--muted); font-size: 13px; }
.view-status { color: var(--muted); font-size: 13px; }
.data-as-of { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.data-warning { padding: 10px 12px; border: 1px solid var(--warn-fg); border-radius: 8px; color: var(--warn-fg); background: var(--warn-bg); }
[hidden] { display: none !important; }
@media (max-width: 600px) {
  .wrap { padding-left: 12px; padding-right: 12px; }
  header.hero { padding-top: 24px; gap: 12px; }
  header.hero h1 { font-size: 24px; }
  .hero .mark { width: 42px; height: 42px; }
  .toolbar { position: static; }
  .dialog-body { padding: 12px; }
  .dialog-toolbar { padding: 10px 12px; }
  .toolbar input[type=search] { min-width: 0; width: 100%; }
  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .stat { min-width: 0; padding: 8px; }
  .stat b { font-size: 20px; }
  .stat span.label { font-size: 11px; }
}
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
    button.title = lang === 'ja' ? 'TurboWarp-Plus-Editorでデモを開く' : 'Open demo in TurboWarp-Plus-Editor';
  }
  if (header) header.setAttribute('site-lang', lang);
  try { localStorage.setItem('lang', lang); } catch (e) {}
}

function apply() {
  const needle = search.value.trim().toLowerCase();
  const active = filters.filter((f) => f.checked).map((f) => f.dataset.filter);

  let matching = 0;
  for (const section of document.querySelectorAll('#package-list section[data-category]')) {
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
    matching += shown;
  }
  document.getElementById('view-status').textContent = document.documentElement.lang === 'ja'
    ? matching + ' 件が一致' : matching + ' packages match';
}

const dialogState = new WeakMap();
window.addEventListener('resize', () => {
  const panel = document.querySelector('.relationship-dialog[open] .graph-variant:not([hidden]) .graph-panel');
  if (panel) panel.scrollLeft = (panel.scrollWidth - panel.clientWidth) / 2;
});
for (const button of document.querySelectorAll('[data-graph-open]')) {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const dialog = document.getElementById(button.dataset.graphOpen);
    dialogState.set(dialog, { opener: button, x: scrollX, y: scrollY });
    dialog.showModal();
    dialog.scrollTop = 0;
    document.documentElement.classList.add('modal-open');
    const panel = dialog.querySelector('.graph-variant:not([hidden]) .graph-panel');
    if (!panel.dataset.positioned) {
      panel.scrollLeft = (panel.scrollWidth - panel.clientWidth) / 2;
      panel.dataset.positioned = 'true';
    }
  });
}
for (const dialog of document.querySelectorAll('.relationship-dialog')) {
  dialog.querySelector('[data-show-dev]').addEventListener('change', (event) => {
    const mode = event.target.checked ? 'all' : 'primary';
    for (const variant of dialog.querySelectorAll('.graph-variant')) variant.hidden = variant.dataset.graphMode !== mode;
    const panel = dialog.querySelector('.graph-variant:not([hidden]) .graph-panel');
    if (!panel.dataset.positioned) {
      panel.scrollLeft = (panel.scrollWidth - panel.clientWidth) / 2;
      panel.dataset.positioned = 'true';
    }
  });
  dialog.querySelector('[data-graph-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('a[href], button, summary, [tabindex]')]
      .filter((element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first?.focus();
    }
  });
  // Native showModal supplies background inertness and Escape.
  // Backdrop clicks intentionally leave the graph open.
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('modal-open');
    const state = dialogState.get(dialog);
    state?.opener.focus({ preventScroll: true });
    if (state) window.scrollTo(state.x, state.y);
  });
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
  apply();
});

setLang(document.documentElement.lang === 'ja' ? 'ja' : 'en');
apply();
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
  return `<a class="demo-play twpe-edit-button twpe-edit-button--small" href="${esc(editor.href)}" target="_blank" rel="noopener noreferrer" title="Open demo in TurboWarp-Plus-Editor">
    <img src="${EDITOR_BRAND_ICON}" alt="" width="24" height="24">
    <span>${t('Demo', 'デモ')}</span>
    <span class="sr-only">${t(`: ${label}; open in TurboWarp-Plus-Editor (new tab)`, `：${label}、TurboWarp-Plus-Editorで開く（新しいタブ）`)}</span>
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

  return `<tr data-search="${esc(haystack)}" data-repo="${esc(pkg.repo)}" data-flags="${esc(flagsFor(pkg).join(' '))}">
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

function relationshipDiagram(report: DashboardReport, categoryId: string, freshness = '', provenance = '', options: { includeDev?: boolean; diagramOnly?: boolean } = {}): string {
  const category = report.categories.find((entry) => entry.id === categoryId)!;
  const includeDev = options.includeDev !== false;
  const graph = categoryRelationships(report.packages, categoryId, { includeDev });
  if (!graph.primary.length) return '';
  const title = t(esc(category.title), esc(category.titleJa ?? category.title));
  const left = graph.external.filter((group) => !group.outgoing.length);
  const right = graph.external.filter((group) => group.outgoing.length);
  const height = Math.max(graph.primary.length * 76 + 90, left.length * 108 + 90, right.length * 108 + 90, 240);
  const variantId = `${categoryId}-${includeDev ? 'all' : 'primary'}`;
  const marker = `arrow-${variantId}`;
  const byRepo = new Map(report.packages.map((pkg) => [pkg.repo, pkg]));
  const link = (repo: string) => {
    const pkg = byRepo.get(repo)!;
    return `<a href="${esc(pkg.github?.url ?? `https://github.com/${report.owner}/${repo}`)}">${esc(pkg.label)}</a>`;
  };
  const kindLabels = { build: ['fixed GUI build', '固定GUIのビルド'], prod: ['runtime', '実行時'], dev: ['development', '開発時'], peer: ['provided by host', 'ホスト側'], optional: ['optional', '任意'] } as const;
  const knownNames = new Set(report.packages.flatMap((pkg) => [pkg.manifest?.name, pkg.npm?.name].filter(Boolean)));
  const unlisted = graph.primary.flatMap((pkg) => (pkg.dependencies ?? [])
    .filter((dep) => dep.name.startsWith(report.scope + '/') && !knownNames.has(dep.name))
    .map((dep) => ({ repo: pkg.repo, ...dep })));
  const edgeList = (edges: typeof graph.edges) => `<ul>${edges.map((edge) =>
    `<li>${link(edge.source)} → ${link(edge.target)} <span class="muted">(${edge.kinds.map((kind) => {
      const label = kindLabels[kind as keyof typeof kindLabels];
      return label ? t(label[0], label[1]) : esc(kind);
    }).join(', ')})</span>${edge.build ? `<br/><span class="muted">${t('Fixed GUI', '固定GUI')}: <a href="https://github.com/${esc(report.owner)}/${esc(edge.target)}/tree/${esc(edge.build.revision)}"><code>${esc(edge.build.revision)}</code></a><br/>${t('Collected HEAD', '収集時のHEAD')}: <code>${esc(byRepo.get(edge.target)?.revision?.head?.oid ?? '')}</code><br/>${t('Source', '根拠')}: <a href="https://github.com/${esc(report.owner)}/${esc(edge.source)}/blob/${esc(edge.build.sourceRevision)}/${edge.build.sourcePath}">site/source.json</a></span>` : ''}</li>`).join('')}</ul>`;
  const node = (pkg: DashboardPackage, x: number, y: number, external = false, caption = '') =>
    `<g class="graph-node ${external ? 'external' : 'primary'}" data-repo="${esc(pkg.repo)}">
      <a href="${esc(pkg.github?.url ?? `https://github.com/${report.owner}/${pkg.repo}`)}">
        <rect x="${x}" y="${y}" width="250" height="${external ? 94 : 60}" rx="9"/>
        <foreignObject x="${x}" y="${y}" width="250" height="${external ? 94 : 60}"><div xmlns="http://www.w3.org/1999/xhtml" class="node-label"><strong>${esc(pkg.label)}</strong>${caption}</div></foreignObject>
      </a>
    </g>`;
  const positions = new Map(graph.primary.map((pkg, i) => [pkg.repo, 64 + i * 76]));
  const primaryNodes = graph.primary.map((pkg) => {
    const pin = graph.edges.find((edge) => edge.target === pkg.repo && edge.build)?.build;
    const caption = pin ? `<small>${t('Fixed GUI', '固定GUI')}: ${esc(pin.revision.slice(0, 7))}</small>` : '';
    return node(pkg, 390, positions.get(pkg.repo)!, false, caption);
  }).join('');
  const internalEdges = graph.internal.map((edge, i) => {
    const sy = positions.get(edge.source)! + 30;
    const ty = positions.get(edge.target)! + 30;
    const lane = 370 - i * 7;
    return `<path class="graph-edge${edge.kinds.every((kind) => kind === 'dev') ? ' development' : ''}" data-edge-source="${esc(edge.source)}" data-edge-target="${esc(edge.target)}" data-edge-kinds="${esc(edge.kinds.join(' '))}" d="M390 ${sy} C${lane} ${sy},${lane} ${ty},390 ${ty}" marker-end="url(#${esc(marker)})"><title>${esc(edge.source)} → ${esc(edge.target)} (${esc(edge.kinds.join(', '))})</title></path>`;
  }).join('');
  const outsideNodes: string[] = [];
  const aggregateEdges: string[] = [];
  for (const [groups, x, boundary] of [[left, 14, 342], [right, 756, 688]] as const) {
    groups.forEach((group, i) => {
      const y = 64 + i * 108;
      const outsideY = y + 47;
      const outsideX = x === 14 ? x + 250 : x;
      const c = report.categories.find((entry) => entry.id === group.category);
      const categoryTitle = t(esc(c?.title ?? group.category), esc(c?.titleJa ?? c?.title ?? group.category));
      const caption = `<small>${categoryTitle}<br/>${t('Outside representative', '別カテゴリの代表')}</small>`;
      outsideNodes.push(node(group.representative, x, y, true, caption));
      for (const [edges, incoming] of [[group.incoming, true], [group.outgoing, false]] as const) {
        if (!edges.length) continue;
        const offset = group.incoming.length && group.outgoing.length ? (incoming ? -14 : 14) : 0;
        const startX = incoming ? outsideX : boundary;
        const endX = incoming ? boundary : outsideX;
        const startY = outsideY + offset;
        const endY = outsideY + offset;
        const mid = (outsideX + boundary) / 2;
        aggregateEdges.push(`<path class="graph-edge aggregate" d="M${startX} ${startY} C${mid} ${startY},${mid} ${endY},${endX} ${endY}" marker-end="url(#${esc(marker)})"><title>${esc(group.category)}: ${incoming ? 'incoming' : 'outgoing'} · ${edges.length}</title></path>
          <rect class="edge-count" x="${mid - 14}" y="${(startY + endY) / 2 - 10}" width="28" height="20" rx="6"/>
          <text class="graph-text" x="${mid}" y="${(startY + endY) / 2 + 4}" text-anchor="middle">${edges.length}</text>`);
      }
    });
  }
  const details = graph.external.map((group) => {
    const c = report.categories.find((entry) => entry.id === group.category);
    const heading = t(esc(c?.title ?? group.category), esc(c?.titleJa ?? c?.title ?? group.category));
    return `<h4>${heading}</h4>${edgeList([...group.incoming, ...group.outgoing])}`;
  }).join('');
  const picture = `    <div class="panel graph-panel" tabindex="0" role="region" aria-labelledby="graph-heading-${esc(categoryId)}">
      <svg class="relationship-svg" viewBox="0 0 1020 ${height}" role="group" aria-labelledby="graph-title-${esc(variantId)} graph-description-${esc(variantId)}">
        <title id="graph-title-${esc(variantId)}">${esc(category.title)} / ${esc(category.titleJa ?? category.title)}</title>
        <desc id="graph-description-${esc(variantId)}">Dependent → dependency. Solid: actual internal edges. Dashed: category aggregate. 利用側 → 依存先。実線：カテゴリ内の実際の依存。破線：カテゴリ単位の集約。Exact edges are listed below / 正確な関係は下の詳細一覧。</desc>
        <defs><marker id="${esc(marker)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/></marker></defs>
        <rect class="category-boundary" x="342" y="14" width="346" height="${height - 28}" rx="16"/>
        <foreignObject x="360" y="20" width="310" height="36"><div xmlns="http://www.w3.org/1999/xhtml" class="node-label">${title}</div></foreignObject>
        ${internalEdges}${aggregateEdges.join('')}${primaryNodes}${outsideNodes.join('')}
      </svg>
    </div>
`;
  if (options.diagramOnly) return picture;
  const primaryPicture = relationshipDiagram(report, categoryId, freshness, provenance, { includeDev: false, diagramOnly: true });
  return `<section data-graph-category="${esc(categoryId)}" aria-labelledby="graph-heading-${esc(categoryId)}">
    <div class="graph-variant" data-graph-mode="primary">${primaryPicture}</div>
    <div class="graph-variant" data-graph-mode="all" hidden>${picture}</div>
    <div class="graph-secondary">
    <label class="development-toggle"><input type="checkbox" data-show-dev> ${t('Include development dependencies', '開発時の依存も表示')}</label>
    <p>${t('Arrows point from the package that uses another package to the package it uses. Select the checkbox to add development dependencies.', '矢印は「使うパッケージ → 使われるパッケージ」の向きです。開発時の依存は、チェックを入れると追加表示します。')}</p>
    <p>${t('Translucent boxes represent other categories. Dashed arrows and their numbers summarize those categories’ relationships, which may involve packages other than the representative shown.', '半透明の枠は別カテゴリの代表パッケージです。破線と数字はそのカテゴリとの関係をまとめたもので、代表への直接の依存とは限りません。')}</p>
    <details class="relationship-details"><summary>${t('Exact package relationships', 'パッケージ間の詳しい関係')}</summary>
    <p>${t('The graph shows catalog packages and their declared dependencies, including development dependencies, regardless of list filters. Dependencies not registered in the catalog are listed separately below.', '図はカタログ登録済みパッケージを対象とし、開発時の依存も含めています。一覧の絞り込みは反映しません。カタログ未登録の依存は下に分けて記載します。')}</p>
    ${graph.internal.length ? `<h4>${t('Within this category', 'このカテゴリ内')}</h4>${edgeList(graph.internal)}` : `<p class="relation-note">${t('No declared dependencies within this category.', 'カテゴリ内の依存宣言はありません。')}</p>`}
    ${details || `<p class="relation-note">${t('No declared relations with other catalog categories.', '他のカタログカテゴリとの依存関係はありません。')}</p>`}
    ${unlisted.length ? `<h4>${t('Not registered in the catalog', 'カタログ未登録の依存')}</h4><ul>${unlisted.map((dep) => `<li>${link(dep.repo)} → <code>${esc(dep.name)}</code> <span class="muted">(${t(kindLabels[dep.kind][0], kindLabels[dep.kind][1])})</span><br/><code>${esc(dep.range)}</code></li>`).join('')}</ul>` : ''}
    </details>
    ${freshness}
    <details class="graph-help"><summary>${t('Data sources', 'データの取得元')}</summary>
      <p>${t('Sources are package.json and verified build-source pins at the collected revision. A GUI pin and its collected HEAD are separate revisions. Representatives are selected from the visible dependency kinds by connection count, then repository name.', '収集時点のpackage.jsonと、ビルド処理を照合した固定GUI情報を使用します。固定GUIと収集時のHEADは別のリビジョンです。別カテゴリの代表は表示中の関係の接続数が最多のものとし、同数ならリポジトリ名順に選びます。')}</p>
      ${provenance}
      <ul>${graph.primary.map((pkg) => `<li><a href="https://github.com/${esc(report.owner)}/${esc(pkg.repo)}/blob/${esc(pkg.revision?.head?.oid ?? pkg.github?.defaultBranch ?? 'HEAD')}/package.json">${esc(pkg.label)}</a></li>`).join('')}</ul>
    </details>
    </div>
  </section>`;
}

async function main() {
  const report = JSON.parse(await readFile(DATA, 'utf8')) as DashboardReport;
  const catalogSource = await readFile(join(ROOT, 'catalog.yaml'), 'utf8').catch(() => null);
  const catalogHash = catalogSource === null ? null : createHash('sha256').update(catalogSource).digest('hex');
  const catalogMatches = Boolean(catalogHash && report.catalog?.sha256 === catalogHash);
  const snapshotTime = Date.parse(report.generatedAt);
  const recent = Number.isFinite(snapshotTime) && snapshotTime <= Date.now() + 60_000 && Date.now() - snapshotTime <= 86_400_000;
  const collectionErrors = report.packages.filter((pkg) => pkg.errors.length).length;
  const verified = catalogMatches && recent && collectionErrors === 0;
  const issues: [string, string][] = [];
  if (!catalogMatches) issues.push(report.catalog && catalogHash
    ? ['Category changes are not reflected in this snapshot.', 'カテゴリ定義の変更がデータに未反映です。']
    : ['The category definition used for this snapshot cannot be verified.', 'データに使用したカテゴリ定義を確認できません。']);
  if (!recent) issues.push(['The acquisition time is invalid or more than 24 hours old.', '取得日時が不明か、取得から24時間以上が経過しています。']);
  if (collectionErrors) issues.push([`Collection failed for ${collectionErrors} packages.`, `${collectionErrors}件のパッケージを取得できませんでした。`]);
  const timeLabel = Number.isFinite(snapshotTime) ? new Date(snapshotTime).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : report.generatedAt;
  const freshness = `<div class="data-as-of" data-freshness="${verified ? 'verified' : 'warning'}">
    <p>${t('Data acquired', 'データ取得')}: <time datetime="${esc(report.generatedAt)}">${esc(timeLabel)}</time></p>
    ${issues.length ? `<p class="data-warning" role="status">${issues.map(([en, ja]) => t(en, ja)).join(' ')} ${t('The view may differ from the current state.', '現在の状況と異なる可能性があります。')}</p>` : ''}
  </div>`;
  const provenance = `<p>${t('GitHub and npm data collected from', 'GitHub・npmの収集期間')}: ${esc(report.collectionStartedAt ?? report.generatedAt)} → ${esc(report.generatedAt)}</p>
    ${report.catalog ? `<p>catalog SHA-256: <code>${esc(report.catalog.sha256)}</code>${report.catalog.revision ? `<br/>${t('Catalog revision', 'カテゴリ定義のリビジョン')}: <code>${esc(report.catalog.revision)}</code>` : ''}</p>` : ''}`;
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
  <div class="category-heading"><h3>${heading}</h3>
    <button type="button" class="category-graph" data-graph-open="relationships-${esc(category.id)}" aria-haspopup="dialog" aria-controls="relationships-${esc(category.id)}" title="${esc(category.title)} / ${esc(category.titleJa ?? category.title)}: Package relationships / パッケージ相関図">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 7L16 7M7 9L11 17M17 9L13 17"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="19" r="3"/></svg>
      <span class="sr-only">${t(`View relationships: ${esc(category.title)}`, `パッケージ相関図を表示：${esc(category.titleJa ?? category.title)}`)}</span>
    </button>
  </div>
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

<main>
<section id="package-list" class="main-content" aria-labelledby="list-heading">
<h2 id="list-heading">${t('Package list', 'パッケージ一覧')}</h2>
${freshness}
<details class="graph-help"><summary>${t('Data sources', 'データの取得元')}</summary>${provenance}</details>
<div class="stats">
${stats}
</div>
<div class="toolbar">
  <label class="sr-only" for="q">${t('Filter by name or description', '名前や説明で絞り込み')}</label>
  <input id="q" type="search" placeholder="Filter by name or description…" autocomplete="off" aria-describedby="view-status">
${filterBoxes}
  <label><input type="checkbox" id="external"> ${t('show external deps', '他社依存も表示')}</label>
  <span class="legend">${t('💀 local reference · ⚠️ stale range', '💀 ローカル参照 ・ ⚠️ stale')}</span>
</div>
<p id="view-status" class="view-status" role="status" aria-live="polite"></p>
${sections}
</section>
</main>

${report.categories.filter((category) => byCategory.get(category.id)?.length).map((category) => `
<dialog class="relationship-dialog" id="relationships-${esc(category.id)}" aria-labelledby="graph-heading-${esc(category.id)}">
  <div class="dialog-toolbar"><h2 id="graph-heading-${esc(category.id)}">${t(`Package relationships <span class="dialog-category">(${esc(category.title)})</span>`, `パッケージ相関図<span class="dialog-category">（${esc(category.titleJa ?? category.title)}）</span>`)}</h2><button type="button" class="dialog-close" data-graph-close autofocus>${t('Close', '閉じる')} <span aria-hidden="true">×</span></button></div>
  <div class="dialog-body">
    ${relationshipDiagram(report, category.id, freshness, provenance)}
  </div>
</dialog>`).join('\n')}


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
