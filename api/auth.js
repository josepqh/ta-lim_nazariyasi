const sql = require('./_db');
const { createSession, destroySession, getSessionUser } = require('./_auth');
const { hashPassword, verifyPassword } = require('./_password');
const { isWithinLimit } = require('./_rateLimit');

const MAX_FAILED_LOGINS = 5;
const MAX_REGISTRATIONS_PER_HOUR = 10;
const SELF_REGISTER_ROLES = new Set(['student', 'teacher']);
const BAD_CREDENTIALS = 'Login yoki parol noto‘g‘ri.';

const publicUser = ({ id, name, login, role }) => ({ id, name, login, role });

async function handleLogin(req, res, body) {
  const login = typeof body.login === 'string' ? body.login.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!login || !password) return res.status(400).json({ error: 'Login va parolni kiriting.' });
  if (password.length > 200) return res.status(401).json({ error: BAD_CREDENTIALS });

  const rows = await sql`
    SELECT id, name, login, role, password, status, deleted_at,
           COALESCE(lockout_until > NOW(), false) AS locked
    FROM np_users WHERE login=${login} LIMIT 1`;
  const account = rows[0];

  if (!account) {
    // Spend the same work as a real check so response time does not reveal which logins exist.
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

async function handleRegister(req, res, body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const login = typeof body.login === 'string' ? body.login.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === undefined ? 'student' : body.role;

  if (!SELF_REGISTER_ROLES.has(role)) return res.status(400).json({ error: 'Ro‘yxatdan o‘tish uchun rol noto‘g‘ri.' });
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Ism 2–100 belgidan iborat bo‘lsin.' });
  if (!/^[\p{L}\p{N}._-]{3,50}$/u.test(login)) return res.status(400).json({ error: 'Login 3–50 belgi bo‘lsin (harf, raqam, nuqta, _ yoki -).' });
  if (password.length < 10 || password.length > 200) return res.status(400).json({ error: 'Parol kamida 10 belgidan iborat bo‘lsin.' });

  if (!(await isWithinLimit('register', req, MAX_REGISTRATIONS_PER_HOUR, 3600))) {
    return res.status(429).json({ error: 'Juda ko‘p ro‘yxatdan o‘tish urinishi. Bir soatdan keyin qayta urinib ko‘ring.' });
  }

  const passwordHash = await hashPassword(password);
  const rows = await sql`
    INSERT INTO np_users(name, login, password, role, last_login_at)
    VALUES(${name}, ${login}, ${passwordHash}, ${role}, NOW())
    RETURNING id, name, login, role`;

  await createSession(req, res, rows[0]);
  return res.status(201).json(publicUser(rows[0]));
}

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
    if (body.action === 'login') return await handleLogin(req, res, body);
    if (body.action === 'register') return await handleRegister(req, res, body);
    return res.status(400).json({ error: 'Noto‘g‘ri so‘rov.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Bu login band, boshqa login tanlang.' });
    console.error(error);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
