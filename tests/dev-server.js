// Local server: static site + real API handlers on an in-memory database. Data resets on restart.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { TEST_ADMIN, createHarness, createResponse } = require('./helpers/harness');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
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

async function main() {
  const { handlers } = await createHarness();

  http.createServer(async (req, res) => {
    for (const { key, value } of securityHeaders) {
      if (key !== 'Strict-Transport-Security') res.setHeader(key, value);
    }
    const url = new URL(req.url, 'http://localhost');
    const apiName = url.pathname.match(/^\/api\/([a-z]+)$/)?.[1];

    if (apiName && handlers[apiName] && apiName !== 'setup') {
      const raw = await readBody(req);
      const apiReq = { method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams), body: raw ? JSON.parse(raw) : undefined };
      const apiRes = createResponse();
      await handlers[apiName](apiReq, apiRes);
      for (const [name, value] of Object.entries(apiRes.headers)) res.setHeader(name, value);
      res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiRes.body));
      return;
    }

    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT, () => {
    console.log(`Local server: http://localhost:${PORT} (admin login: ${TEST_ADMIN.login})`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
