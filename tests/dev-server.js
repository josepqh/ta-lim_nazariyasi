// Runs the site and the real API handlers.
// With DATABASE_URL in .env it uses that database; otherwise a local one stored in .local-db/.
require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { TEST_ADMIN, createHarness, createResponse } = require('./helpers/harness');

const ROOT = path.join(__dirname, '..');
const HANDLER_NAMES = ['auth', 'chat', 'content', 'files', 'modules', 'profile', 'progress', 'quiz', 'users'];
const NEVER_SERVED = new Set(['node_modules', 'tests', 'api', 'test-results', 'playwright-report', 'package.json', 'package-lock.json', 'run_setup.js', 'playwright.config.js', 'vercel.json', 'README.md']);
const MAX_PORT_ATTEMPTS = 10;
const LOCK_FILE = path.join(ROOT, '.local-db.lock');
let localDatabaseClaimed = false;
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

// Removes the trial accounts earlier versions added to the local database.
async function retireTrialAccounts(sql) {
  const trial = [['student', 'Sinov Talaba'], ['teacher', 'Sinov O‘qituvchi'], ['admin', 'Sinov Administrator']];
  for (const [login, name] of trial) {
    await sql`DELETE FROM np_sessions WHERE user_id IN (SELECT id FROM np_users WHERE login=${login} AND name=${name})`;
    await sql`UPDATE np_users SET status='blocked', deleted_at=NOW() WHERE login=${login} AND name=${name} AND deleted_at IS NULL`;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The local database file supports one process, and a second server would also run stale code unnoticed.
function claimLocalDatabase() {
  if (fs.existsSync(LOCK_FILE)) {
    const { pid, port } = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (isProcessAlive(pid)) {
      console.error(`Sayt allaqachon ishlayapti: http://localhost:${port} (jarayon ${pid}).`);
      console.error(`Qayta ishga tushirish uchun avval uni to‘xtating: kill ${pid}`);
      process.exit(1);
    }
  }
  writeLock(null);
  const release = () => fs.rmSync(LOCK_FILE, { force: true });
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
  localDatabaseClaimed = true;
}

function writeLock(port) {
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, port }));
}

async function useLocalDatabase() {
  const dataDir = process.env.LOCAL_DB_DIR === 'memory' ? undefined : path.join(ROOT, '.local-db');
  if (dataDir) claimLocalDatabase();
  const { handlers, sql } = await createHarness({ dataDir });
  console.log(`Baza: ${dataDir ? 'lokal (.local-db, ma’lumotlar saqlanadi)' : 'xotirada'}`);
  if (dataDir) await retireTrialAccounts(sql);
  console.log(`Admin login: ${TEST_ADMIN.login} (parol: tests/helpers/harness.js faylida)`);
  if (!process.env.GMAIL_USER) {
    process.env.LOCAL_DEV_MAIL = '1';
    console.log('Gmail sozlanmagan: tasdiqlash kodlari shu terminalga chiqadi.');
  }
  return handlers;
}

// Lets browser tests read the code a real user would get by email. Never enabled by npm start.
const testMailbox = new Map();
function captureTestMail() {
  const mail = require('../api/_mail');
  mail.sendCode = async (to, code) => { testMailbox.set(to, code); };
  mail.sendExistingAccountNotice = async () => {};
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
  server.listen(port, () => {
    if (localDatabaseClaimed) writeLock(port);
    console.log(`Sayt ishga tushdi: http://localhost:${port}`);
  });
}

async function main() {
  const handlers = process.env.DATABASE_URL ? await useRealDatabase() : await useLocalDatabase();
  const exposeMail = process.env.E2E_MAIL === '1' && process.env.LOCAL_DB_DIR === 'memory';
  if (exposeMail) captureTestMail();

  const server = http.createServer(async (req, res) => {
    for (const { key, value } of securityHeaders) {
      if (key !== 'Strict-Transport-Security') res.setHeader(key, value);
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      const apiName = url.pathname.match(/^\/api\/([a-z]+)$/)?.[1];
      if (exposeMail && url.pathname === '/__test/mail') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: testMailbox.get(url.searchParams.get('to')) || null }));
        return;
      }
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
