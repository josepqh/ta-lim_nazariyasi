const sql = require('./_db');
const { createSession, requireUser } = require('./_auth');
const { hashPassword, verifyPassword } = require('./_password');
const { consumeLimit } = require('./_rateLimit');

const MAX_PASSWORD_ATTEMPTS = 5;
const PASSWORD_ATTEMPT_WINDOW_SECONDS = 15 * 60;

async function readProfile(res, user) {
  const rows = await sql`
    SELECT id, name, login, role, created_at, last_login_at
    FROM np_users WHERE id=${user.id} LIMIT 1`;
  return res.json(rows[0]);
}

async function updateName(res, user, body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Ism 2–100 belgidan iborat bo‘lsin.' });
  const rows = await sql`
    UPDATE np_users SET name=${name}, updated_at=NOW() WHERE id=${user.id}
    RETURNING id, name, login, role, created_at, last_login_at`;
  return res.json(rows[0]);
}

async function changePassword(req, res, user, body) {
  const current = typeof body.current_password === 'string' ? body.current_password : '';
  const next = typeof body.new_password === 'string' ? body.new_password : '';
  if (next.length < 10 || next.length > 200) return res.status(400).json({ error: 'Yangi parol kamida 10 belgidan iborat bo‘lsin.' });
  if (current.length > 200) return res.status(400).json({ error: 'Joriy parol noto‘g‘ri.' });

  if (!(await consumeLimit(`password-change:user:${user.id}`, MAX_PASSWORD_ATTEMPTS, PASSWORD_ATTEMPT_WINDOW_SECONDS))) {
    return res.status(429).json({ error: 'Juda ko‘p urinish. 15 daqiqadan keyin qayta urinib ko‘ring.' });
  }

  const rows = await sql`SELECT password FROM np_users WHERE id=${user.id} LIMIT 1`;
  if (!(await verifyPassword(current, rows[0]?.password))) return res.status(400).json({ error: 'Joriy parol noto‘g‘ri.' });

  const passwordHash = await hashPassword(next);
  await sql`UPDATE np_users SET password=${passwordHash}, updated_at=NOW() WHERE id=${user.id}`;
  // Other devices sign out; this one gets a fresh session.
  await sql`DELETE FROM np_sessions WHERE user_id=${user.id}`;
  await createSession(req, res, user);
  return res.json({ ok: true });
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'PATCH', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });
    const user = await requireUser(req, res);
    if (!user) return;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (req.method === 'GET') return await readProfile(res, user);
    if (req.method === 'PATCH') return await updateName(res, user, body);
    return await changePassword(req, res, user, body);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
