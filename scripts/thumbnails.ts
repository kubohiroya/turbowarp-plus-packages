#!/usr/bin/env -S npx tsx
/**
 * Screenshots the home page of every published GitHub Pages site into
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
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext } from 'playwright';
import { errorMessage } from './lib/errors.ts';
import type { DashboardPackage, DashboardReport, PagesStatus } from './lib/types.ts';

type ColorScheme = 'light' | 'dark';
type Target = DashboardPackage & { pages: PagesStatus & { url: string } };
type Shot = { ok: true; bytes: Buffer } | { ok: false; reason: string };
type CaptureResult =
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
async function capture(context: BrowserContext, pkg: Target): Promise<CaptureResult> {
  const shots = {} as Record<ColorScheme, Buffer>;
  for (const scheme of SCHEMES) {
    const shot = await shoot(context, pkg, scheme);
    if (!shot.ok) return { repo: pkg.repo, ok: false, scheme, reason: shot.reason };
    shots[scheme] = shot.bytes;
  }

  await writeFile(join(THUMBS, `${pkg.repo}.light.png`), shots.light);

  const darkDiffers = digest(shots.light) !== digest(shots.dark);
  const darkPath = join(THUMBS, `${pkg.repo}.dark.png`);
  if (darkDiffers) {
    await writeFile(darkPath, shots.dark);
  } else {
    // A stale file from a previous run would otherwise claim a dark variant
    // that this run decided not to keep.
    await rm(darkPath, { force: true });
  }

  return { repo: pkg.repo, ok: true, dark: darkDiffers };
}

async function main() {
  const report = JSON.parse(await readFile(DATA, 'utf8')) as DashboardReport;
  const targets = report.packages.filter(
    (pkg): pkg is Target => Boolean(pkg.pages?.enabled && pkg.pages.url && pkg.pages.live !== false),
  );

  if (!targets.length) {
    console.log('no live Pages sites to shoot');
    return;
  }

  await mkdir(THUMBS, { recursive: true });

  const { chromium } = await import('playwright');
  // The full Chromium build, not the headless shell: it renders these pages
  // the way a visitor's browser does, which is the point of a thumbnail.
  const browser = await chromium.launch({ channel: 'chromium' });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 0.5,
    reducedMotion: 'reduce',
  });

  const results: CaptureResult[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      while (next < targets.length) {
        results.push(await capture(context, targets[next++]));
      }
    }),
  );

  await context.close();
  await browser.close();

  const captured = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const withDark = captured.filter((r) => r.dark);

  await writeFile(
    join(THUMBS, 'index.json'),
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        captured: captured.map((r) => r.repo).sort(),
        withDarkVariant: withDark.map((r) => r.repo).sort(),
        failed,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    `captured ${captured.length}/${targets.length} thumbnails, ` +
      `${withDark.length} with a distinct dark variant`,
  );
  for (const failure of failed) {
    console.warn(`  ${failure.repo} (${failure.scheme}): ${failure.reason}`);
  }
}

await main();
