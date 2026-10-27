import type { DemoProject, PagesStatus } from './types.ts';

const TIMEOUT_MS = 15_000;

/** Select the first declared sample that is already downloadable from Pages. */
export async function publishedDemo(manifestText: string | null | undefined, pages: PagesStatus): Promise<DemoProject | null> {
  if (!manifestText || !pages.enabled || !pages.url || pages.live === false) return null;
  let base: URL;
  let samples: unknown;
  try {
    base = new URL(pages.url);
    if (base.protocol !== 'https:') return null;
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    base.search = '';
    base.hash = '';
    samples = JSON.parse(manifestText)?.samples;
  } catch {
    return null;
  }
  if (!Array.isArray(samples)) return null;

  for (const sample of samples) {
    if (!sample || typeof sample.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sample.name)) continue;
    const projectUrl = new URL(`samples/${sample.name}.sb3`, base).href;
    try {
      const response = await fetch(projectUrl, {
        headers: { 'user-agent': 'turbowarp-plus-packages', range: 'bytes=0-3' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // A 200 HTML fallback is not a project, and the Editor needs CORS access.
      const signature = Buffer.from(await response.arrayBuffer()).subarray(0, 4);
      if (!response.ok || response.headers.get('access-control-allow-origin') !== '*' ||
          !signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) continue;
      return {
        projectUrl,
        title: typeof sample.title === 'string' && sample.title.trim() ? sample.title : sample.name,
      };
    } catch {
      // One missing sample must not hide another or stop package collection.
    }
  }
  return null;
}
