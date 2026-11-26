// Minimal static server for the exported web build (SPA fallback to index.html).
// Test-only; production hosting is deploy/default.conf.template (nginx). The
// same security headers (including the Content-Security-Policy) are read from
// deploy/security-headers.inc.template so the e2e suite runs under the
// production policy.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? 'dist';
const port = Number(process.argv[3] ?? 8081);
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.tflite': 'application/octet-stream',
};
const apiOrigin = new URL(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').origin;
const headerFile = join(
  dirname(fileURLToPath(import.meta.url)),
  '../deploy/security-headers.inc.template',
);
const securityHeaders = [
  ...readFileSync(headerFile, 'utf8').matchAll(/^add_header\s+(\S+)\s+"([^"]*)"/gm),
]
  // HSTS only makes sense over TLS; the test server is plain HTTP.
  .filter(([, name]) => name !== 'Strict-Transport-Security')
  .map(([, name, value]) => [name, value.replaceAll('${API_ORIGIN}', apiOrigin)]);
if (!securityHeaders.some(([n]) => n === 'Content-Security-Policy'))
  throw new Error(`no Content-Security-Policy found in ${headerFile}`);

createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(
    /^(\.\.[/\\])+/,
    '',
  );
  let file = join(root, path);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = existsSync(`${file}.html`) ? `${file}.html` : join(root, 'index.html');
  }
  res.writeHead(200, {
    ...Object.fromEntries(securityHeaders),
    'content-type': types[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${root} on :${port}`));
