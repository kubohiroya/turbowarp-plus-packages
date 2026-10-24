#!/usr/bin/env node
/**
 * Screenshots the home page of every published GitHub Pages site into
 * site/thumbs/<repo>.png.
 *
 * Shots are taken at half device scale, so a 1200x750 viewport lands as a
 * 600x375 image: small enough to ship 50 of them, sharp enough to recognise
 * a page by. Failures are reported and skipped; one unreachable site must not
 * cost us the whole set.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'dashboard.json');
const THUMBS = join(ROOT, 'site', 'thumbs');

const VIEWPORT = { width: 1200, height: 750 };
const CONCURRENCY = 4;
const TIMEOUT_MS = 30_000;

async function shoot(context, pkg) {
  const page = await context.newPage();
  try {
    const response = await page.goto(pkg.pages.url, {
      waitUntil: 'networkidle',
      timeout: TIMEOUT_MS,
    });
    if (!response?.ok()) {
      return { repo: pkg.repo, ok: false, reason: `HTTP ${response?.status() ?? 'no response'}` };
    }
    // Give webfonts and late-loading hero images a moment to settle.
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(THUMBS, `${pkg.repo}.png`), fullPage: false });
    return { repo: pkg.repo, ok: true };
  } catch (error) {
    return { repo: pkg.repo, ok: false, reason: error.message.split('\n')[0] };
  } finally {
    await page.close();
  }
}

async function main() {
  const report = JSON.parse(await readFile(DATA, 'utf8'));
  const targets = report.packages.filter((pkg) => pkg.pages?.enabled && pkg.pages.url && pkg.pages.live !== false);

  if (!targets.length) {
    console.log('no live Pages sites to shoot');
    return;
  }

  await mkdir(THUMBS, { recursive: true });

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 0.5,
    // Pages sites of this family animate on load; a still shot is what we want.
    reducedMotion: 'reduce',
  });

  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      while (next < targets.length) {
        const pkg = targets[next++];
        results.push(await shoot(context, pkg));
      }
    }),
  );

  await context.close();
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  await writeFile(
    join(THUMBS, 'index.json'),
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        captured: results.filter((r) => r.ok).map((r) => r.repo).sort(),
        failed,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`captured ${results.length - failed.length}/${targets.length} thumbnails`);
  for (const failure of failed) console.warn(`  ${failure.repo}: ${failure.reason}`);
}

await main();
