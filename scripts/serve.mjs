#!/usr/bin/env node
/** Serves site/ for a local look at the dashboard. */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const PORT = Number(process.env.PORT ?? 4180);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(SITE, relative);

  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    response.writeHead(404).end('not found');
    return;
  }

  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
