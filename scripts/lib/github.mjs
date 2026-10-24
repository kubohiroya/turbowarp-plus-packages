import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const API = 'https://api.github.com';

let cachedToken;

/**
 * A token is required: unauthenticated GitHub API access is capped at 60
 * requests per hour, which is not enough for even one package. In CI this is
 * the workflow's GITHUB_TOKEN; locally it falls back to the gh CLI.
 */
export async function getToken() {
  if (cachedToken !== undefined) return cachedToken;

  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return (cachedToken = fromEnv.trim());

  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token']);
    return (cachedToken = stdout.trim());
  } catch {
    throw new Error(
      'No GitHub token. Set GITHUB_TOKEN, or sign in with `gh auth login`.',
    );
  }
}

async function request(url, init = {}, { retries = 3 } = {}) {
  const token = await getToken();
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'turbowarp-plus-packages',
        ...init.headers,
      },
    });

    if (response.status === 403 || response.status === 429) {
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const remaining = Number(response.headers.get('x-ratelimit-remaining'));
      if (remaining === 0 && Number.isFinite(reset) && attempt < retries) {
        const waitMs = Math.max(0, reset * 1000 - Date.now()) + 1000;
        console.warn(`rate limited; waiting ${Math.round(waitMs / 1000)}s`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
    }

    if (response.status >= 500 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }

    return response;
  }
}

/** Runs one GraphQL document. Partial `errors` are returned, not thrown. */
export async function graphql(query, variables = {}) {
  const response = await request(`${API}/graphql`, {
    method: 'POST',
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL ${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  return { data: body.data ?? {}, errors: body.errors ?? [] };
}

/** REST GET. Returns null for 404 so "not configured" is not an error. */
export async function rest(path) {
  const response = await request(`${API}${path}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub REST ${response.status} on ${path}: ${await response.text()}`);
  }
  return response.json();
}

/** Runs `worker` over `items`, at most `limit` at a time, preserving order. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
