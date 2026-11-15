// A small static file server for game/, Node 22 standard library only, so the
// game can be played locally with no build step: `node serve.ts` and open
// http://localhost:8080. It serves only files inside game/, answers the MIME
// types a browser game needs, and does nothing else — a development
// convenience, not a production web server.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const asked = portIndex === -1 ? 8080 : Number(args[portIndex + 1]);
const port = Number.isInteger(asked) && asked > 0 && asked < 65536 ? asked : 8080;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
  const path = join(root, relative === '' ? 'index.html' : relative);
  if (path !== root && !path.startsWith(root + sep)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(path).pipe(response);
}).listen(port, () => {
  console.log(`Sable Yard at http://localhost:${port}`);
});
