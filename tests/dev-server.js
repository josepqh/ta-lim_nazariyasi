// Runs the site and the real API handlers.
// With DATABASE_URL in .env it uses that database; otherwise a local one stored in .local-db/.
require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { TEST_ADMIN, createHarness, createResponse } = require('./helpers/harness');

const ROOT = path.join(__dirname, '..');
const HANDLER_NAMES = ['auth', 'content', 'files', 'modules', 'progress', 'users'];
const NEVER_SERVED = new Set(['node_modules', 'tests', 'api', 'test-results', 'playwright-report', 'package.json', 'package-lock.json', 'run_setup.js', 'playwright.config.js', 'vercel.json', 'README.md']);
const MAX_PORT_ATTEMPTS = 10;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
};
const securityHeaders = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).headers[0].headers;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function useRealDatabase() {
  const sql = require('../api/_db');
  const [{ ready }] = await sql`SELECT to_regclass('np_rate_limits') IS NOT NULL AS ready`;
  if (!ready) {
    console.error('Baza hali sozlanmagan. Avval quyidagini ishga tushiring: npm run db:setup');
    process.exit(1);
  }
  console.log('Baza: .env dagi DATABASE_URL');
  return Object.fromEntries(HANDLER_NAMES.map((name) => [name, require(`../api/${name}.js`)]));
}

async function useLocalDatabase() {
  const dataDir = process.env.LOCAL_DB_DIR === 'memory' ? undefined : path.join(ROOT, '.local-db');
  const { handlers } = await createHarness({ dataDir });
  console.log(`Baza: ${dataDir ? 'lokal (.local-db, ma’lumotlar saqlanadi)' : 'xotirada'}`);
  console.log(`Admin login: ${TEST_ADMIN.login} (parol: tests/helpers/harness.js faylida)`);
  return handlers;
}

function isServable(relative) {
  return relative.split('/').every((segment) => segment && !segment.startsWith('.'))
    && !NEVER_SERVED.has(relative.split('/')[0]);
}

async function handleApi(req, res, handler, url) {
  const raw = await readBody(req);
  const apiReq = {
    method: req.method,
    headers: req.headers,
    query: Object.fromEntries(url.searchParams),
    body: raw ? JSON.parse(raw) : undefined
  };
  const apiRes = createResponse();
  await handler(apiReq, apiRes);
  for (const [name, value] of Object.entries(apiRes.headers)) res.setHeader(name, value);
  res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(apiRes.body));
}

function serveStatic(res, url) {
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(ROOT, relative);
  const insideRoot = file.startsWith(`${ROOT}${path.sep}`);
  if (!insideRoot || !isServable(path.relative(ROOT, file)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function listen(server, port, attemptsLeft) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 0) return listen(server, port + 1, attemptsLeft - 1);
    throw error;
  });
  server.listen(port, () => console.log(`Sayt ishga tushdi: http://localhost:${port}`));
}

async function main() {
  const handlers = process.env.DATABASE_URL ? await useRealDatabase() : await useLocalDatabase();

  const server = http.createServer(async (req, res) => {
    for (const { key, value } of securityHeaders) {
      if (key !== 'Strict-Transport-Security') res.setHeader(key, value);
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      const apiName = url.pathname.match(/^\/api\/([a-z]+)$/)?.[1];
      if (apiName && HANDLER_NAMES.includes(apiName)) await handleApi(req, res, handlers[apiName], url);
      else if (url.pathname.startsWith('/api/')) res.writeHead(404).end('Not found');
      else serveStatic(res, url);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Noto‘g‘ri so‘rov.' }));
    }
  });

  const fixedPort = process.env.PORT;
  listen(server, Number(fixedPort || 3000), fixedPort ? 0 : MAX_PORT_ATTEMPTS);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
