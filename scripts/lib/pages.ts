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

async function findSvgFavicon(html: string, pageUrl: string): Promise<string | null> {
  for (const url of faviconUrls(html, pageUrl)) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': 'turbowarp-plus-packages' },
      });
      const body = await response.text();
      // An HTML fallback at a missing .svg URL is not a usable favicon.
      if (response.ok && /^\s*(?:<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE\s+svg\b[^>]*>\s*)*<svg(?:\s|>)/i.test(body)) {
        return response.url || url;
      }
    } catch { /* Optional artwork must not change the Pages health result. */ }
  }
  return null;
}

/** Probe Pages once; only apps need their HTML inspected for an SVG favicon. */
export async function checkLive(url: string, discoverSvgFavicon = false): Promise<
  Pick<PagesStatus, 'live' | 'httpStatus' | 'svgFaviconUrl'>
> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'turbowarp-plus-packages' },
    });
    const result = { live: response.ok, httpStatus: response.status };
    if (response.ok && discoverSvgFavicon) {
      const html = await response.text().catch(() => '');
      return { ...result, svgFaviconUrl: await findSvgFavicon(html, response.url || url) };
    }
    // Drain the body so the socket can be reused.
    await response.arrayBuffer().catch(() => {});
    return result;
  } catch {
    return { live: false, httpStatus: null };
  }
}
