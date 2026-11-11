const { createHash, randomInt, timingSafeEqual } = require('node:crypto');
const { reportServerError } = require('../_errors');
const sql = require('../_db');
const { createSession, destroySession, getSessionUser } = require('../_auth');
const { normalizeGmail } = require('../_email');
const mail = require('../_mail');
const { hashPassword, verifyPassword } = require('../_password');
const { consumeLimit, isWithinLimit } = require('../_rateLimit');

const MAX_FAILED_LOGINS = 5;
const MAX_CODE_REQUESTS_PER_HOUR = 10;
const MAX_CODES_PER_MAILBOX_PER_HOUR = 5;
const MAX_CODE_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const SELF_REGISTER_ROLES = new Set(['student', 'teacher']);
const BAD_CREDENTIALS = 'Gmail yoki parol noto‘g‘ri.';
const BAD_EMAIL = 'To‘g‘ri Gmail manzilini kiriting (…@gmail.com).';
const BAD_PASSWORD = 'Parol kamida 10 belgidan iborat bo‘lsin.';
const BAD_CODE = 'Kod noto‘g‘ri.';
const EXPIRED_CODE = 'Kod eskirgan yoki urinishlar tugagan. Yangi kod oling.';
const PENDING_TEACHER = 'Hisobingiz administrator tasdig‘ini kutmoqda. Tasdiqlangach shu Gmail bilan kiring.';

const publicUser = ({ id, name, login, role }) => ({ id, name, login, role });
const validPassword = (value) => typeof value === 'string' && value.length >= 10 && value.length <= 200;
const hashCode = (email, purpose, code) => createHash('sha256').update(`${email}:${purpose}:${code}`).digest();

async function findAccount(email) {
  const rows = await sql`SELECT id FROM np_users WHERE login=${email} AND deleted_at IS NULL LIMIT 1`;
  return rows[0] || null;
}

// Stores the code before sending. `send` may skip the email, so answers don't reveal who has an account.
async function issueCode(res, req, email, purpose, payload, send) {
  if (!(await isWithinLimit('code', req, MAX_CODE_REQUESTS_PER_HOUR, 3600))
    || !(await consumeLimit(`code:mailbox:${email}`, MAX_CODES_PER_MAILBOX_PER_HOUR, 3600))) {
    res.status(429).json({ error: 'Juda ko‘p urinish. Bir soatdan keyin qayta urinib ko‘ring.' });
    return false;
  }
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const serialized = payload ? JSON.stringify(payload) : null;
  const rows = await sql`
    INSERT INTO np_email_codes(email, purpose, code_hash, payload, expires_at)
    VALUES(${email}, ${purpose}, ${hashCode(email, purpose, code).toString('hex')}, ${serialized}, NOW() + INTERVAL '10 minutes')
    ON CONFLICT(email, purpose) DO UPDATE
      SET code_hash=EXCLUDED.code_hash, payload=EXCLUDED.payload, attempts=0, expires_at=EXCLUDED.expires_at, last_sent_at=NOW()
      WHERE np_email_codes.last_sent_at <= NOW() - (${RESEND_COOLDOWN_SECONDS}::int * INTERVAL '1 second')
    RETURNING email`;
  if (!rows.length) {
    res.status(429).json({ error: 'Yangi kod olish uchun bir daqiqa kuting.' });
    return false;
  }
  try {
    await send(code);
  } catch (error) {
    await sql`DELETE FROM np_email_codes WHERE email=${email} AND purpose=${purpose}`;
    if (!(error instanceof mail.MailNotConfiguredError)) console.error('Mail delivery failed:', error.message);
    res.status(503).json({ error: 'Xat yuborib bo‘lmadi. Birozdan keyin urinib ko‘ring.' });
    return false;
  }
  return true;
}

// Returns { payload } on success, or { error } with a message.
async function consumeCode(email, purpose, code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return { error: BAD_CODE };
  // Counting the attempt first means parallel guesses cannot exceed the limit.
  const rows = await sql`
    UPDATE np_email_codes SET attempts = attempts + 1
    WHERE email=${email} AND purpose=${purpose} AND expires_at > NOW() AND attempts < ${MAX_CODE_ATTEMPTS}::int
    RETURNING code_hash, payload`;
  if (!rows.length) return { error: EXPIRED_CODE };
  const expected = Buffer.from(rows[0].code_hash, 'hex');
  if (!timingSafeEqual(expected, hashCode(email, purpose, code.trim()))) return { error: BAD_CODE };
  await sql`DELETE FROM np_email_codes WHERE email=${email} AND purpose=${purpose}`;
  return { payload: rows[0].payload };
}

async function handleLogin(req, res, body) {
  const raw = typeof body.login === 'string' ? body.login.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!raw || !password) return res.status(400).json({ error: 'Gmail va parolni kiriting.' });
  if (password.length > 200) return res.status(401).json({ error: BAD_CREDENTIALS });
  const login = normalizeGmail(raw) || raw;

  const rows = await sql`
    SELECT id, name, login, role, password, status, deleted_at,
           COALESCE(lockout_until > NOW(), false) AS locked
    FROM np_users WHERE login=${login} LIMIT 1`;
  const account = rows[0];

  if (!account) {
    // Spend the same work as a real check so response time does not reveal which accounts exist.
    await hashPassword(password);
    return res.status(401).json({ error: BAD_CREDENTIALS });
  }
  if (account.locked) {
    return res.status(429).json({ error: 'Juda ko‘p urinish. 15 daqiqadan keyin qayta urinib ko‘ring.' });
  }

  if (!(await verifyPassword(password, account.password))) {
    await sql`
      UPDATE np_users SET
        failed_login_count = CASE WHEN COALESCE(failed_login_count, 0) + 1 >= ${MAX_FAILED_LOGINS}::int THEN 0
                                  ELSE COALESCE(failed_login_count, 0) + 1 END,
        lockout_until = CASE WHEN COALESCE(failed_login_count, 0) + 1 >= ${MAX_FAILED_LOGINS}::int
                             THEN NOW() + INTERVAL '15 minutes' ELSE lockout_until END
      WHERE id=${account.id}`;
    return res.status(401).json({ error: BAD_CREDENTIALS });
  }

  if (account.status === 'pending' && !account.deleted_at) {
    return res.status(403).json({ error: PENDING_TEACHER, pending: true });
  }
  if (account.deleted_at || (account.status && account.status !== 'active')) {
    return res.status(403).json({ error: 'Hisobingiz faol emas. Administratorga murojaat qiling.' });
  }
  if (!['student', 'teacher', 'admin'].includes(account.role)) {
    return res.status(403).json({ error: 'Hisob roli sozlanmagan.' });
  }

  await sql`UPDATE np_users SET failed_login_count=0, lockout_until=NULL, last_login_at=NOW() WHERE id=${account.id}`;
  await createSession(req, res, account);
  return res.json(publicUser(account));
}

async function startRegistration(req, res, body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = normalizeGmail(body.email);
  const role = body.role === undefined ? 'student' : body.role;

  if (!SELF_REGISTER_ROLES.has(role)) return res.status(400).json({ error: 'Ro‘yxatdan o‘tish uchun rol noto‘g‘ri.' });
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Ism 2–100 belgidan iborat bo‘lsin.' });
  if (!email) return res.status(400).json({ error: BAD_EMAIL });
  if (!validPassword(body.password)) return res.status(400).json({ error: BAD_PASSWORD });

  const existing = await findAccount(email);
  const payload = existing ? null : { name, role, password: await hashPassword(body.password) };
  const sent = await issueCode(res, req, email, 'register', payload, (code) => (
    existing ? mail.sendExistingAccountNotice(body.email.trim()) : mail.sendCode(body.email.trim(), code, 'register')
  ));
  if (sent) return res.json({ ok: true, email });
}

async function finishRegistration(req, res, body) {
  const email = normalizeGmail(body.email);
  if (!email) return res.status(400).json({ error: BAD_EMAIL });
  const { payload, error } = await consumeCode(email, 'register', body.code);
  if (error) return res.status(400).json({ error });
  if (!payload) return res.status(400).json({ error: BAD_CODE });

  // Teachers can change course material and see every student's work, so an administrator approves them first.
  if (payload.role === 'teacher') {
    await sql`
      INSERT INTO np_users(name, login, password, role, status)
      VALUES(${payload.name}, ${email}, ${payload.password}, 'teacher', 'pending')`;
    const admins = await sql`SELECT login FROM np_users WHERE role='admin' AND deleted_at IS NULL AND COALESCE(status, 'active')='active'`;
    for (const admin of admins) {
      if (admin.login.includes('@')) await mail.sendTeacherRequest(admin.login, payload.name, email);
    }
    return res.status(202).json({ pending: true, message: PENDING_TEACHER });
  }

  const rows = await sql`
    INSERT INTO np_users(name, login, password, role, last_login_at)
    VALUES(${payload.name}, ${email}, ${payload.password}, ${payload.role}, NOW())
    RETURNING id, name, login, role`;
  await createSession(req, res, rows[0]);
  return res.status(201).json(publicUser(rows[0]));
}

async function startReset(req, res, body) {
  const email = normalizeGmail(body.email);
  if (!email) return res.status(400).json({ error: BAD_EMAIL });
  const account = await findAccount(email);
  const sent = await issueCode(res, req, email, 'reset', account ? { user_id: account.id } : null, async (code) => {
    if (account) await mail.sendCode(body.email.trim(), code, 'reset');
  });
  if (sent) return res.json({ ok: true, email });
}

async function finishReset(req, res, body) {
  const email = normalizeGmail(body.email);
  if (!email) return res.status(400).json({ error: BAD_EMAIL });
  if (!validPassword(body.password)) return res.status(400).json({ error: BAD_PASSWORD });
  const { payload, error } = await consumeCode(email, 'reset', body.code);
  if (error) return res.status(400).json({ error });
  if (!payload) return res.status(400).json({ error: BAD_CODE });

  const passwordHash = await hashPassword(body.password);
  await sql`UPDATE np_users SET password=${passwordHash}, failed_login_count=0, lockout_until=NULL WHERE id=${payload.user_id}`;
  // A changed password must end every device's session.
  await sql`DELETE FROM np_sessions WHERE user_id=${payload.user_id}`;
  return res.json({ ok: true });
}

const ACTIONS = {
  login: handleLogin,
  register_start: startRegistration,
  register_verify: finishRegistration,
  reset_start: startReset,
  reset_verify: finishReset
};

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') return res.json({ user: await getSessionUser(req) });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.action === 'logout') {
      await destroySession(req, res);
      return res.json({ ok: true });
    }
    const action = Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!action) return res.status(400).json({ error: 'Noto‘g‘ri so‘rov.' });
    return await action(req, res, body);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Bu Gmail bilan hisob allaqachon bor.' });
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
