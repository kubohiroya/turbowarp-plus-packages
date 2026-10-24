#!/usr/bin/env node
/**
 * Generates the brand assets from one source of truth.
 *
 *   site/assets/icon.svg   the mark
 *   site/assets/og.svg     the social card
 *   site/assets/*.png      rasterised versions (needs playwright)
 *
 * The mark is a hat block - the shape every Scratch-family editor uses for the
 * block that starts a script - filled with a warp swirl and carrying a plus.
 * The silhouette says "block programming"; the plus says "something added".
 * No letterform or colour is taken from the TurboWarp logo.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'site', 'assets');

const COLORS = {
  from: '#6d28e0',
  mid: '#3b55e0',
  to: '#11a3d8',
  warp: '#bdf4ff',
  cardFrom: '#15102f',
  cardTo: '#07253c',
};

/**
 * A hat block: a dome over the top edge, a square-ish body, and the puzzle tab
 * underneath that the next block in the script clips onto.
 */
const HAT = [
  'M16 78',
  'c8-60 216-60 224 0',
  'V190',
  'a26 26 0 0 1-26 26',
  'H132',
  'c-4 0-7 3-8 6l-6 10c-3 5-8 8-14 8H80c-6 0-11-3-14-8l-6-10c-1-3-4-6-8-6',
  'H42',
  'a26 26 0 0 1-26-26',
  'Z',
].join('');

/** A plus centred in the body of the block. */
const PLUS = 'M128 100v80M88 140h80';

const GRADIENTS = `
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${COLORS.from}"/>
      <stop offset=".5" stop-color="${COLORS.mid}"/>
      <stop offset="1" stop-color="${COLORS.to}"/>
    </linearGradient>
    <linearGradient id="warp" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${COLORS.warp}" stop-opacity="0"/>
      <stop offset="1" stop-color="${COLORS.warp}" stop-opacity=".9"/>
    </linearGradient>`;

const MARK = `  <path fill="url(#body)" d="${HAT}"/>

  <g clip-path="url(#inside)" fill="none" stroke="url(#warp)" stroke-linecap="round">
    <path d="M14 140A114 114 0 0 1 128 26" stroke-width="17"/>
    <path d="M48 140a80 80 0 0 1 80-80" stroke-width="13" opacity=".6"/>
    <path d="M82 140a46 46 0 0 1 46-46" stroke-width="9" opacity=".4"/>
  </g>

  <path d="${PLUS}" fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round"/>`;

const icon = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="TurboWarp Plus">
  <title>TurboWarp Plus</title>
  <desc>A hat block filled with a warp swirl, carrying a plus sign.</desc>
  <defs>${GRADIENTS}
    <clipPath id="inside"><path d="${HAT}"/></clipPath>
  </defs>

${MARK}
</svg>
`;

const card = ({ title, tagline, url }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${COLORS.cardFrom}"/>
      <stop offset="1" stop-color="${COLORS.cardTo}"/>
    </linearGradient>${GRADIENTS}
    <clipPath id="inside"><path d="${HAT}"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="url(#card)"/>
  <g transform="translate(96 187)">
${MARK}
  </g>
  <g font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
    <text x="400" y="288" font-size="76" font-weight="700" fill="#fff" letter-spacing="-1">${title}</text>
    <text x="402" y="348" font-size="30" fill="#9db6d6">${tagline}</text>
    <text x="402" y="402" font-size="25" fill="#6f8dad">${url}</text>
  </g>
</svg>
`;


/** Rasterise an SVG with the browser playwright already installs. */
async function rasterise(svg, out, width, height) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace(
        /width="\d+" height="\d+"/,
        `width="${width}" height="${height}"`,
      )}</body></html>`,
    );
    await page.screenshot({ path: out, omitBackground: true });
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(ASSETS, { recursive: true });

  const iconSvg = icon();
  const cardSvg = card({
    title: 'TurboWarp Plus',
    tagline: 'Extensions, toolchains and apps that complement TurboWarp',
    url: 'kubohiroya.github.io/turbowarp-plus-packages',
  });

  await writeFile(join(ASSETS, 'icon.svg'), iconSvg);
  await writeFile(join(ASSETS, 'og.svg'), cardSvg);
  console.log('wrote icon.svg, og.svg');

  if (process.argv.includes('--no-raster')) return;

  for (const [name, size] of [
    ['favicon-32.png', 32],
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
  ]) {
    await rasterise(iconSvg, join(ASSETS, name), size, size);
    console.log(`wrote ${name}`);
  }
  await rasterise(cardSvg, join(ASSETS, 'og.png'), 1200, 630);
  console.log('wrote og.png');
}

await main();
