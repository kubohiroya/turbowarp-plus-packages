import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { publishedDemo } from '../scripts/lib/demos.ts';

const PAGE = 'https://example.github.io/extension/';
const PROJECT = `${PAGE}samples/hello-world.sb3`;
const MANIFEST = JSON.stringify({ samples: [{ name: 'hello-world', title: 'Hello world' }] });
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

function mockFetch(t: TestContext, routes: Record<string, Response | Error>) {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    assert.ok(init?.signal, 'Requests must have a timeout');
    assert.equal((init.headers as Record<string, string>).range, 'bytes=0-3');
    const result = routes[url];
    if (!result) throw new Error(`Unexpected URL: ${url}`);
    if (result instanceof Error) throw result;
    return result;
  });
  return calls;
}

test('selects a published sample from the actual Pages URL, ignoring a stale manifest baseURL', async (t) => {
  mockFetch(t, { [PROJECT]: new Response(ZIP, { status: 206, headers: { 'access-control-allow-origin': '*' } }) });
  assert.deepEqual(await publishedDemo(JSON.stringify({ baseURL: 'https://old.example/',
    samples: [{ name: 'hello-world', title: 'Hello world' }] }), { enabled: true, url: PAGE, live: true }), {
    projectUrl: PROJECT, title: 'Hello world',
  });
});

test('missing, invalid or unavailable sample declarations do not cause network requests', async (t) => {
  const calls = mockFetch(t, {});
  for (const manifest of [null, undefined, '', '{', 'null', '{}', '{"samples":{}}',
    JSON.stringify({ samples: [null, {}, { name: '../private' }, { name: 'https://other.example/x' }] })]) {
    assert.equal(await publishedDemo(manifest, { enabled: true, url: PAGE }), null);
  }
  for (const pages of [{ enabled: false }, { enabled: true }, { enabled: true, url: 'invalid' },
    { enabled: true, url: 'http://example.org/' }, { enabled: true, url: PAGE, live: false }]) {
    assert.equal(await publishedDemo(MANIFEST, pages), null);
  }
  assert.deepEqual(calls, []);
});

test('does not advertise HTML fallbacks, missing CORS, HTTP failures, or network failures', async (t) => {
  for (const response of [new Response('<html>Not found</html>', { headers: { 'access-control-allow-origin': '*' } }),
    new Response(ZIP), new Response(ZIP, { status: 404, headers: { 'access-control-allow-origin': '*' } }),
    new Error('Timed out')]) {
    mockFetch(t, { [PROJECT]: response });
    assert.equal(await publishedDemo(MANIFEST, { enabled: true, url: PAGE }), null);
  }
});

test('tries the next sample after a missing one and uses its name when no title is provided', async (t) => {
  const second = `${PAGE}samples/second.sb3`;
  const calls = mockFetch(t, {
    [PROJECT]: new Response('Missing', { status: 404 }),
    [second]: new Response(ZIP, { headers: { 'access-control-allow-origin': '*' } }),
  });
  assert.deepEqual(await publishedDemo(JSON.stringify({ samples: [{ name: 'hello-world' }, { name: 'second' }] }),
    { enabled: true, url: PAGE.slice(0, -1) }), { projectUrl: second, title: 'second' });
  assert.deepEqual(calls, [PROJECT, second]);
});
