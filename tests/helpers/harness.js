// Runs the real API handlers against an in-memory PostgreSQL engine (no Neon, no network).
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const API_DIR = path.join(__dirname, '..', '..', 'api');

// Local-only credentials used by tests and `npm run dev:local`.
const TEST_ADMIN = { login: 'local_admin', password: 'local-admin-password' };

function toDriverParam(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value); // The pg driver also sends these as text.
}

async function createDatabase(dataDir) {
  const identity = (value) => value;
  const db = new PGlite(dataDir);
  await db.waitReady;
  const sql = async (strings, ...values) => {
    const text = strings.reduce((query, part, index) => `${query}$${index}${part}`);
    try {
      const result = await db.query(text, values.map(toDriverParam), {
        serializers: { 114: identity, 3802: identity }
      });
      return result.rows;
    } catch (error) {
      error.query = text;
      throw error;
    }
  };
  return { db, sql };
}

function loadHandlers(sql) {
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://local/test',
    SETUP_SECRET: 'local-setup-secret-at-least-24',
    ADMIN_LOGIN: TEST_ADMIN.login,
    ADMIN_PASSWORD: TEST_ADMIN.password,
    ADMIN_NAME: 'Local Administrator'
  });
  const dbPath = path.join(API_DIR, '_db.js');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: sql };
  return Object.fromEntries(['auth', 'chat', 'content', 'files', 'modules', 'progress', 'quiz', 'setup', 'users']
    .map((name) => [name, require(path.join(API_DIR, `${name}.js`))]));
}

async function runSetup(handlers) {
  const res = createResponse();
  await handlers.setup({
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SETUP_SECRET}` }
  }, res);
  if (res.statusCode !== 200) throw new Error(`Setup failed: ${JSON.stringify(res.body)}`);
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
}

async function createHarness({ dataDir } = {}) {
  const { db, sql } = await createDatabase(dataDir);
  const handlers = loadHandlers(sql);
  const outbox = [];
  // Called only by the test suite; the local server must keep sending real mail.
  function stubMail() {
    const mail = require(path.join(API_DIR, '_mail.js'));
    mail.sendCode = async (to, code, purpose) => { outbox.push({ to, code, purpose }); };
    mail.sendExistingAccountNotice = async (to) => { outbox.push({ to, notice: true }); };
  }
  const registered = new Set();
  await runSetup(handlers);

  // A small client that keeps its own session cookie, like one browser.
  function client() {
    let cookie = '';
    async function call(name, { method = 'GET', query = {}, body, headers = {} } = {}) {
      const req = { method, query, body, headers: cookie ? { ...headers, cookie } : headers };
      const res = createResponse();
      await handlers[name](req, res);
      const setCookie = res.headers['set-cookie'];
      if (setCookie) cookie = setCookie.split(';')[0];
      return res;
    }
    return {
      call,
      post: (name, body) => call(name, { method: 'POST', body }),
      get: (name, query = {}) => call(name, { query }),
      async register(name, role) {
        const email = `${name}@gmail.com`;
        const started = await call('auth', { method: 'POST', body: { action: 'register_start', name: `Name ${name}`, email, password: 'a-valid-password', role } });
        if (started.statusCode !== 200) return started;
        const { code } = outbox.findLast((item) => item.to === email);
        await sql`UPDATE np_email_codes SET last_sent_at = NOW() - INTERVAL '2 minutes' WHERE email=${email}`;
        registered.add(name);
        return call('auth', { method: 'POST', body: { action: 'register_verify', email, code } });
      },
      login: (login, password) => call('auth', { method: 'POST', body: { action: 'login', login: registered.has(login) ? `${login}@gmail.com` : login, password } }),
      async upload({ moduleId, stepType, purpose, filename, bytes }) {
        const init = await this.post('files', {
          action: 'init', module_id: moduleId, step_type: stepType, purpose, filename, size: bytes.length
        });
        if (init.statusCode !== 201) return init;
        for (let index = 0; index < init.body.total_chunks; index++) {
          const part = bytes.subarray(index * init.body.chunk_size, (index + 1) * init.body.chunk_size);
          const sent = await this.post('files', {
            action: 'chunk', id: init.body.id, index, data: part.toString('base64')
          });
          if (sent.statusCode !== 200) return sent;
        }
        return this.post('files', { action: 'complete', id: init.body.id });
      }
    };
  }

  return { db, sql, handlers, client, outbox, stubMail };
}

module.exports = { TEST_ADMIN, createHarness, createResponse };
