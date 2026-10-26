#!/usr/bin/env -S npx tsx
/**
 * Screenshots new or version-changed GitHub Pages sites into
 * site/thumbs/<repo>.<scheme>.png.
 *
 * Each site is shot twice, once with `prefers-color-scheme: light` and once
 * with dark, because the dashboard follows that same preference: a light
 * thumbnail on a dark page looks like a hole punched in the table. Sites that
 * do not implement dark mode produce two identical files, so the dark copy is
 * dropped and the page falls back to the light one.
 *
 * Shots are taken at half device scale, so a 1200x750 viewport lands as a
 * 600x375 image: small enough to ship a hundred of them, sharp enough to
 * recognise a page by. Failures are reported and skipped; one unreachable site
 * must not cost us the whole set.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BrowserContext } from 'playwright';
import { errorMessage } from './lib/errors.ts';
import type { DashboardPackage, DashboardReport, PagesStatus } from './lib/types.ts';

type ColorScheme = 'light' | 'dark';
export type Target = DashboardPackage & { pages: PagesStatus & { url: string } };
type Shot = { ok: true; bytes: Buffer } | { ok: false; reason: string };
export type CaptureResult =
  | { repo: string; ok: true; dark: boolean }
  | { repo: string; ok: false; scheme: ColorScheme; reason: string };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'dashboard.json');
const THUMBS = join(ROOT, 'site', 'thumbs');

const VIEWPORT = { width: 1200, height: 750 };
const SCHEMES = ['light', 'dark'] as const;
const CONCURRENCY = 3;
const TIMEOUT_MS = 30_000;

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * One shot of one site under one colour scheme. The scheme is emulated before
 * navigation so that a page reading it at load time sees the right value.
 */
async function shoot(context: BrowserContext, pkg: Target, scheme: ColorScheme): Promise<Shot> {
  const page = await context.newPage();
  try {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const response = await page.goto(pkg.pages.url, {
      waitUntil: 'networkidle',
      timeout: TIMEOUT_MS,
    });
    if (!response?.ok()) {
      return { ok: false, reason: `HTTP ${response?.status() ?? 'no response'}` };
    }
    // Give webfonts and late-loading hero images a moment to settle.
    await page.waitForTimeout(600);
    const bytes = await page.screenshot({ fullPage: false });
    return { ok: true, bytes };
  } catch (error) {
    return { ok: false, reason: errorMessage(error).split('\n')[0] };
  } finally {
    await page.close();
  }
}

/** Both schemes for one site, keeping the dark copy only when it differs. */
async function capture(context: BrowserContext, pkg: Target, directory: string): Promise<CaptureResult> {
  const shots = {} as Record<ColorScheme, Buffer>;
  for (const scheme of SCHEMES) {
    const shot = await shoot(context, pkg, scheme);
    if (!shot.ok) return { repo: pkg.repo, ok: false, scheme, reason: shot.reason };
    shots[scheme] = shot.bytes;
  }

  await writeFile(join(directory, `${pkg.repo}.light.png`), shots.light);

  const darkDiffers = digest(shots.light) !== digest(shots.dark);
  const darkPath = join(directory, `${pkg.repo}.dark.png`);
  if (darkDiffers) {
    await writeFile(darkPath, shots.dark);
  } else {
    // A stale file from a previous run would otherwise claim a dark variant
    // that this run decided not to keep.
    await rm(darkPath, { force: true });
  }

  return { repo: pkg.repo, ok: true, dark: darkDiffers };
}

interface Snapshot {
  key: string;
  dark: boolean;
}

/** Commit-only changes do not invalidate sites that expose release versions. */
export function thumbnailKey(pkg: Target): string {
  const versions = {
    manifest: pkg.manifest?.version ?? null,
    tag: pkg.revision?.tag?.name ?? null,
    npm: Object.fromEntries(Object.entries(
      pkg.npm?.distTags ?? {latest: pkg.npm?.latest ?? null},
    ).sort(([a], [b]) => a.localeCompare(b))),
  };
  const hasVersion = versions.manifest || versions.tag ||
    Object.values(versions.npm).some(Boolean);
  return JSON.stringify({
    schema: 1,
    url: pkg.pages.url,
    ...versions,
    head: hasVersion ? null : pkg.revision?.head?.oid ?? null,
  });
}

async function imageExists(filename: string): Promise<boolean> {
  try {
    const info = await stat(filename);
    return info.isFile() && info.size > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Keep successful snapshots across runs; failed refreshes remain retryable. */
export async function generateThumbnails(
  targets: Target[],
  directory: string,
  captureTargets: (packages: Target[]) => Promise<CaptureResult[]>,
) {
  await mkdir(directory, {recursive: true});
  let previous: Record<string, Snapshot> = {};
  try {
    previous = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8')).snapshots ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const snapshots: Record<string, Snapshot> = {};
  const pending: Target[] = [];
  const reused: string[] = [];
  for (const pkg of targets) {
    const old = previous[pkg.repo];
    const complete = old && await imageExists(join(directory, `${pkg.repo}.light.png`)) &&
      (!old.dark || await imageExists(join(directory, `${pkg.repo}.dark.png`)));
    if (complete) snapshots[pkg.repo] = old;
    if (complete && old.key === thumbnailKey(pkg)) reused.push(pkg.repo);
    else pending.push(pkg);
  }
  const results = pending.length ? await captureTargets(pending) : [];
  for (const result of results) {
    if (result.ok) {
      const pkg = pending.find((pkg) => pkg.repo === result.repo)!;
      snapshots[result.repo] = {key: thumbnailKey(pkg), dark: result.dark};
    }
  }
  const captured = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  await writeFile(join(directory, 'index.json'), `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    captured: Object.keys(snapshots).sort(),
    refreshed: captured.map((result) => result.repo).sort(),
    reused: reused.sort(),
    withDarkVariant: Object.keys(snapshots).filter((repo) => snapshots[repo].dark).sort(),
    failed,
    snapshots,
  }, null, 2)}\n`);
  return {captured: captured.length, reused: reused.length, failed};
}

async function main() {
  const report = JSON.parse(await readFile(DATA, 'utf8')) as DashboardReport;
  const targets = report.packages.filter(
    (pkg): pkg is Target => Boolean(pkg.pages?.enabled && pkg.pages.url && pkg.pages.live !== false),
  );
  const result = await generateThumbnails(targets, THUMBS, async (pending) => {
    // Unchanged snapshots never require launching or installing a browser.
    const {chromium} = await import('playwright');
    const browser = await chromium.launch({channel: 'chromium'});
    try {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 0.5,
        reducedMotion: 'reduce',
      });
      const results: CaptureResult[] = [];
      let next = 0;
      await Promise.all(Array.from({length: Math.min(CONCURRENCY, pending.length)}, async () => {
        while (next < pending.length) results.push(await capture(context, pending[next++], THUMBS));
      }));
      return results;
    } finally {
      await browser.close();
    }
  });
  console.log(`captured ${result.captured}/${targets.length} thumbnails, reused ${result.reused}`);
  for (const failure of result.failed) {
    console.warn(`  ${failure.repo} (${failure.scheme}): ${failure.reason}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
