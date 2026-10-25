import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { checkLive, faviconUrls } from '../scripts/lib/pages.ts';

const PAGE = 'https://example.github.io/app/';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h20v20z"/></svg>';

function mockFetch(t: TestContext, routes: Record<string, Response | Error>) {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    assert.ok(init?.signal, 'Every request must have a timeout');
    const response = routes[url];
    if (!response) throw new Error(`Unexpected URL: ${url}`);
    if (response instanceof Error) throw response;
    return response;
  });
  return calls;
}

test('resolves quoted and unquoted icon URLs, rel tokens, base URL and entities', () => {
  assert.deepEqual(faviconUrls(`
    <BASE href="/assets/">
    <base href="/ignored/">
    <LINK HREF='logo.svg?v=1&amp;theme=auto' REL='shortcut ICON' TYPE='image/svg+xml'>
    <link rel=icon href=/app/favicon.svg />
    <link rel="icon" href="https://cdn.example.org/icon">
    <link rel=icon href="logo.svg?v=1&#38;theme=auto">
    <link rel=apple-touch-icon href="apple.png">
  `, PAGE), [
    'https://example.github.io/assets/logo.svg?v=1&theme=auto',
    'https://example.github.io/app/favicon.svg',
    'https://cdn.example.org/icon',
  ]);
});

test('ignores commented and scripted declarations, unsafe URLs and non-SVG data', () => {
  assert.deepEqual(faviconUrls(`
    <!-- <link rel=icon href="comment.svg"> -->
    <script>const example = '<link rel=icon href="script.svg">';</script>
    <template><link rel=icon href="template.svg"></template>
    <link rel=icon href="javascript:alert(1)">
    <link rel=icon href="file:///tmp/icon.svg">
    <link rel=icon href="data:,">
    <link rel=icon href="data:image/png;base64,AAAA">
    <link rel=icon href="http://[invalid">
  `, PAGE), []);
});

test('collects a declared SVG favicon without requiring a .svg extension', async (t) => {
  const iconUrl = `${PAGE}assets/icon?theme=auto&v=1`;
  const calls = mockFetch(t, {
    [PAGE]: new Response('<link rel="icon" href="assets/icon?theme=auto&amp;v=1">'),
    [iconUrl]: new Response(SVG),
  });
  assert.deepEqual(await checkLive(PAGE, true), { live: true, httpStatus: 200, svgFaviconUrl: iconUrl, faviconUrl: iconUrl });
  assert.deepEqual(calls, [PAGE, iconUrl]);
});

test('resolves relative icons against the final page URL after redirects', async (t) => {
  const response = new Response('<link rel=icon href="icon.svg">');
  Object.defineProperty(response, 'url', { value: 'https://custom.example.org/deployed/' });
  const iconUrl = 'https://custom.example.org/deployed/icon.svg';
  mockFetch(t, {
    [PAGE]: response,
    [iconUrl]: new Response(`<?xml version="1.0"?><!-- icon --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${SVG}`),
  });
  assert.equal((await checkLive(PAGE, true)).svgFaviconUrl, iconUrl);
});

test('skips corrupt images, HTML fallbacks, HTTP errors and network failures to find an SVG', async (t) => {
  const links = ['png', 'fallback.svg', 'missing.svg', 'offline.svg', 'valid.svg'];
  mockFetch(t, {
    [PAGE]: new Response(links.map((href) => `<link rel=icon href="${href}">`).join('')),
    [`${PAGE}png`]: new Response('PNG bytes', { headers: { 'content-type': 'image/png' } }),
    [`${PAGE}fallback.svg`]: new Response('<!doctype html><html>Not found</html>'),
    [`${PAGE}missing.svg`]: new Response(SVG, { status: 404 }),
    [`${PAGE}offline.svg`]: new Error('Connection failed'),
    [`${PAGE}valid.svg`]: new Response(SVG),
  });
  assert.deepEqual(await checkLive(PAGE, true), {
    live: true, httpStatus: 200, svgFaviconUrl: `${PAGE}valid.svg`, faviconUrl: `${PAGE}valid.svg`,
  });
});

test('favicon failure preserves a healthy Pages status and permits the block icon fallback', async (t) => {
  mockFetch(t, {
    [PAGE]: new Response('<link rel=icon href="missing.svg">'),
    [`${PAGE}missing.svg`]: new Error('Timed out'),
  });
  assert.deepEqual(await checkLive(PAGE, true), { live: true, httpStatus: 200, svgFaviconUrl: null, faviconUrl: null });
});

test('a page without an icon does not trigger guessed favicon requests', async (t) => {
  const calls = mockFetch(t, { [PAGE]: new Response('<html><head></head></html>') });
  assert.deepEqual(await checkLive(PAGE, true), { live: true, httpStatus: 200, svgFaviconUrl: null, faviconUrl: null });
  assert.deepEqual(calls, [PAGE]);
});

test('other categories keep the existing single-request health check', async (t) => {
  const calls = mockFetch(t, { [PAGE]: new Response('<link rel=icon href="icon.svg">') });
  assert.deepEqual(await checkLive(PAGE), { live: true, httpStatus: 200 });
  assert.deepEqual(calls, [PAGE]);
});

test('unhealthy Pages do not trigger favicon requests', async (t) => {
  const calls = mockFetch(t, { [PAGE]: new Response('<link rel=icon href="icon.svg">', { status: 503 }) });
  assert.deepEqual(await checkLive(PAGE, true), { live: false, httpStatus: 503 });
  assert.deepEqual(calls, [PAGE]);
});

test('unreachable Pages retain their existing failure status', async (t) => {
  mockFetch(t, { [PAGE]: new Error('Connection refused') });
  assert.deepEqual(await checkLive(PAGE, true), { live: false, httpStatus: null });
});

test('supports a declared SVG data URL', async (t) => {
  const iconUrl = `data:image/svg+xml,${encodeURIComponent(SVG)}`;
  mockFetch(t, { [PAGE]: new Response(`<link rel="icon" href="${iconUrl}">`), [iconUrl]: new Response(SVG) });
  assert.equal((await checkLive(PAGE, true)).svgFaviconUrl, iconUrl);
});

test('uses a declared PNG favicon when no SVG is available, respecting the final icon URL', async (t) => {
  const image = new Response(PNG, { headers: { 'content-type': 'image/png' } });
  Object.defineProperty(image, 'url', { value: 'https://cdn.example.org/favicon.png' });
  mockFetch(t, { [PAGE]: new Response('<link rel="icon" type="image/png" href="favicon.png">'),
    [`${PAGE}favicon.png`]: image });
  assert.deepEqual(await checkLive(PAGE, true), { live: true, httpStatus: 200,
    svgFaviconUrl: null, faviconUrl: 'https://cdn.example.org/favicon.png' });
});

test('prefers a valid SVG over an earlier valid PNG declaration', async (t) => {
  mockFetch(t, {
    [PAGE]: new Response('<link rel=icon href="favicon.png"><link rel=icon href="icon.svg">'),
    [`${PAGE}favicon.png`]: new Response(PNG), [`${PAGE}icon.svg`]: new Response(SVG),
  });
  assert.deepEqual(await checkLive(PAGE, true), { live: true, httpStatus: 200,
    svgFaviconUrl: `${PAGE}icon.svg`, faviconUrl: `${PAGE}icon.svg` });
});

test('rejects truncated PNGs, checksum errors and HTML responses claiming to be PNGs', async (t) => {
  const corrupt = Buffer.from(PNG);
  corrupt[45] ^= 1;
  for (const body of [PNG.subarray(0, 30), corrupt, Buffer.from('<html>Missing</html>')]) {
    mockFetch(t, { [PAGE]: new Response('<link rel=icon href="favicon.png">'),
      [`${PAGE}favicon.png`]: new Response(body, { headers: { 'content-type': 'image/png' } }) });
    assert.deepEqual(await checkLive(PAGE, true), { live: true, httpStatus: 200,
      svgFaviconUrl: null, faviconUrl: null });
  }
});

test('keeps a valid PNG fallback when a later SVG cannot be fetched', async (t) => {
  mockFetch(t, {
    [PAGE]: new Response('<link rel=icon href="favicon.png"><link rel=icon href="missing.svg">'),
    [`${PAGE}favicon.png`]: new Response(PNG), [`${PAGE}missing.svg`]: new Error('Unavailable'),
  });
  assert.equal((await checkLive(PAGE, true)).faviconUrl, `${PAGE}favicon.png`);
});
