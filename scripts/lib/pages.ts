import type { PagesStatus } from './types.ts';

const TIMEOUT_MS = 15_000;

function decodeAttribute(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1].toLowerCase() === 'x'
        ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' } as Record<string, string>)[name.toLowerCase()];
  });
}

/** Read declared icons, respecting the deployed URL and the first base URL. */
export function faviconUrls(html: string, pageUrl: string): string[] {
  const links: Record<string, string>[] = [];
  let baseUrl = pageUrl;
  let hasBase = false;
  // Ignore comments and raw text elements so examples and scripts are not icons.
  const tags = /<!--[\s\S]*?-->|<(script|style|textarea|title|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>|<(link|base)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi;
  for (const tag of html.matchAll(tags)) {
    if (!tag[2]) continue;
    const attrs: Record<string, string> = {};
    const attributes = /([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const attr of tag[3].matchAll(attributes)) {
      const key = attr[1].toLowerCase();
      if (!(key in attrs)) attrs[key] = decodeAttribute(attr[2] ?? attr[3] ?? attr[4] ?? '');
    }
    if (tag[2].toLowerCase() === 'base') {
      if (!hasBase && attrs.href !== undefined) {
        hasBase = true;
        try { baseUrl = new URL(attrs.href, pageUrl).href; } catch { /* Keep the page URL. */ }
      }
    } else {
      links.push(attrs);
    }
  }

  const urls: string[] = [];
  for (const attrs of links) {
    if (!attrs.rel?.toLowerCase().split(/\s+/).includes('icon') || !attrs.href) continue;
    try {
      const url = new URL(attrs.href, baseUrl);
      const dataSvg = /^data:image\/svg\+xml[;,]/i.test(url.href);
      if (!['https:', 'http:'].includes(url.protocol) && !dataSvg) continue;
      urls.push(url.href);
    } catch { /* An invalid declaration does not hide other icons. */ }
  }
  return [...new Set(urls)];
}

/** Check PNG structure and chunk checksums before using optional artwork. */
function isPng(body: Buffer): boolean {
  if (!body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let hasData = false;
  for (let offset = 8; offset + 12 <= body.length;) {
    const length = body.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > body.length) return false;
    const type = body.toString('ascii', offset + 4, offset + 8);
    let crc = 0xffffffff;
    for (let i = offset + 4; i < end - 4; i++) {
      crc ^= body[i];
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== body.readUInt32BE(end - 4)) return false;
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13 || !body.readUInt32BE(offset + 8) || !body.readUInt32BE(offset + 12)) return false;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT' && length > 0) hasData = true;
    if (type === 'IEND') return length === 0 && hasData && end === body.length;
    offset = end;
  }
  return false;
}

async function findFavicon(html: string, pageUrl: string): Promise<Pick<PagesStatus, 'svgFaviconUrl' | 'faviconUrl'>> {
  let pngUrl: string | null = null;
  for (const url of faviconUrls(html, pageUrl)) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': 'turbowarp-plus-packages' },
      });
      const body = Buffer.from(await response.arrayBuffer());
      // An HTML fallback at a missing .svg URL is not a usable favicon.
      if (response.ok && /^\s*(?:<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE\s+svg\b[^>]*>\s*)*<svg(?:\s|>)/i.test(body.toString('utf8'))) {
        const svgUrl = response.url || url;
        return { svgFaviconUrl: svgUrl, faviconUrl: svgUrl };
      }
      if (response.ok && !pngUrl && isPng(body)) pngUrl = response.url || url;
    } catch { /* Optional artwork must not change the Pages health result. */ }
  }
  return { svgFaviconUrl: null, faviconUrl: pngUrl };
}

/** Probe Pages once; apps prefer SVG favicons, with declared PNGs as a fallback. */
export async function checkLive(url: string, discoverFavicon = false): Promise<
  Pick<PagesStatus, 'live' | 'httpStatus' | 'svgFaviconUrl' | 'faviconUrl'>
> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'turbowarp-plus-packages' },
    });
    const result = { live: response.ok, httpStatus: response.status };
    if (response.ok && discoverFavicon) {
      const html = await response.text().catch(() => '');
      return { ...result, ...await findFavicon(html, response.url || url) };
    }
    // Drain the body so the socket can be reused.
    await response.arrayBuffer().catch(() => {});
    return result;
  } catch {
    return { live: false, httpStatus: null };
  }
}
