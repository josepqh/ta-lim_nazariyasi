const sql = require('../_db');
const { requireUser } = require('../_auth');
const { audit } = require('../_audit');
const { normalizeCode, randomCode } = require('../_codes');
const { reportServerError } = require('../_errors');
const { consumeLimit } = require('../_rateLimit');

const CODE_LENGTH = 6;
const MAX_JOIN_TRIES_PER_HOUR = 20;
const STAFF = ['teacher', 'admin'];

const groupName = (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');

// A group a teacher may change: their own, or any for the administrator.
async function loadOwnGroup(res, user, id) {
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: 'Guruh raqami noto‘g‘ri.' });
    return null;
  }
  const rows = await sql`SELECT id, name, teacher_id, code FROM np_groups WHERE id=${id} LIMIT 1`;
  const group = rows[0];
  if (!group || (user.role !== 'admin' && Number(group.teacher_id) !== Number(user.id))) {
    res.status(404).json({ error: 'Guruh topilmadi.' });
    return null;
  }
  return group;
}

async function uniqueCode() {
  for (let i = 0; i < 10; i++) {
    const code = randomCode(CODE_LENGTH);
    const taken = await sql`SELECT 1 FROM np_groups WHERE code=${code} LIMIT 1`;
    if (!taken.length) return code;
  }
  throw new Error('Could not find a free group code');
}

async function list(req, res, user) {
  if (user.role === 'student') {
    return res.json(await sql`
      SELECT g.id, g.name, u.name AS teacher_name, m.joined_at
      FROM np_group_members m JOIN np_groups g ON g.id = m.group_id JOIN np_users u ON u.id = g.teacher_id
      WHERE m.user_id=${user.id} ORDER BY m.joined_at DESC`);
  }
  const id = req.query.id === undefined ? null : Number(req.query.id);
  if (id !== null) {
    const group = await loadOwnGroup(res, user, id);
    if (!group) return;
    const members = await sql`
      SELECT u.id, u.name, u.login, m.joined_at,
             COALESCE(p.finished, 0)::int AS modules_finished, COALESCE(p.score, 0)::int AS total_score
      FROM np_group_members m
      JOIN np_users u ON u.id = m.user_id AND u.deleted_at IS NULL
      LEFT JOIN (
        SELECT user_id, COUNT(*) FILTER (WHERE jsonb_array_length(completed_steps) >= 6) AS finished, SUM(total_score) AS score
        FROM np_progress WHERE module_id IN (SELECT id FROM np_modules WHERE deleted_at IS NULL) GROUP BY user_id
      ) p ON p.user_id = u.id
      WHERE m.group_id=${group.id}
      ORDER BY u.name`;
    return res.json({ ...group, members });
  }
  return res.json(await sql`
    SELECT g.id, g.name, g.code, g.teacher_id, g.created_at, u.name AS teacher_name,
           (SELECT COUNT(*)::int FROM np_group_members m WHERE m.group_id = g.id) AS member_count
    FROM np_groups g JOIN np_users u ON u.id = g.teacher_id
    WHERE ${user.role === 'admin'}::boolean OR g.teacher_id=${user.id}
    ORDER BY g.created_at DESC`);
}

async function create(res, user, body) {
  const name = groupName(body.name);
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Guruh nomi 2–100 belgidan iborat bo‘lsin.' });
  const [group] = await sql`
    INSERT INTO np_groups(name, teacher_id, code) VALUES(${name}, ${user.id}, ${await uniqueCode()})
    RETURNING id, name, code, teacher_id, created_at`;
  await audit(user, 'group.create', `Guruh: ${name}`, { group_id: group.id });
  return res.status(201).json({ ...group, member_count: 0 });
}

async function join(res, user, body) {
  if (!(await consumeLimit(`group-join:user:${user.id}`, MAX_JOIN_TRIES_PER_HOUR, 3600))) {
    return res.status(429).json({ error: 'Juda ko‘p urinish. Bir soatdan keyin qayta urinib ko‘ring.' });
  }
  const code = normalizeCode(body.code);
  const rows = code.length === CODE_LENGTH ? await sql`SELECT id, name FROM np_groups WHERE code=${code} LIMIT 1` : [];
  if (!rows.length) return res.status(404).json({ error: 'Bunday kodli guruh topilmadi. Kodni o‘qituvchingizdan tekshirib oling.' });
  const inserted = await sql`
    INSERT INTO np_group_members(group_id, user_id) VALUES(${rows[0].id}, ${user.id})
    ON CONFLICT DO NOTHING RETURNING group_id`;
  if (!inserted.length) return res.status(409).json({ error: `Siz allaqachon “${rows[0].name}” guruhidasiz.` });
  return res.status(201).json({ id: rows[0].id, name: rows[0].name });
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const user = await requireUser(req, res);
    if (!user) return;
    if (req.method === 'GET') return await list(req, res, user);

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (req.method === 'POST' && user.role === 'student') {
      if (body.action === 'join') return await join(res, user, body);
      if (body.action === 'leave') {
        const id = Number(body.id);
        const left = await sql`DELETE FROM np_group_members WHERE group_id=${id} AND user_id=${user.id} RETURNING group_id`;
        return left.length ? res.json({ ok: true }) : res.status(404).json({ error: 'Guruh topilmadi.' });
      }
      return res.status(403).json({ error: 'Bu amal uchun ruxsat yo‘q.' });
    }
    if (!STAFF.includes(user.role)) return res.status(403).json({ error: 'Bu amal uchun ruxsat yo‘q.' });

    if (req.method === 'DELETE') {
      const group = await loadOwnGroup(res, user, Number(req.query.id));
      if (!group) return;
      await sql`DELETE FROM np_groups WHERE id=${group.id}`;
      await audit(user, 'group.delete', `Guruh: ${group.name}`, { group_id: group.id });
      return res.json({ ok: true });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });
    if (body.action === 'create') return await create(res, user, body);

    const group = await loadOwnGroup(res, user, Number(body.id));
    if (!group) return;
    if (body.action === 'rename') {
      const name = groupName(body.name);
      if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Guruh nomi 2–100 belgidan iborat bo‘lsin.' });
      const [row] = await sql`UPDATE np_groups SET name=${name} WHERE id=${group.id} RETURNING id, name, code`;
      return res.json(row);
    }
    if (body.action === 'new_code') {
      // An old code that leaked stops working at once.
      const [row] = await sql`UPDATE np_groups SET code=${await uniqueCode()} WHERE id=${group.id} RETURNING id, name, code`;
      return res.json(row);
    }
    if (body.action === 'remove_member') {
      const removed = await sql`
        DELETE FROM np_group_members WHERE group_id=${group.id} AND user_id=${Number(body.user_id)} RETURNING user_id`;
      if (!removed.length) return res.status(404).json({ error: 'Talaba bu guruhda emas.' });
      await audit(user, 'group.remove_member', `Guruh: ${group.name}`, { group_id: group.id, user_id: Number(body.user_id) });
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'Noto‘g‘ri so‘rov.' });
  } catch (error) {
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
