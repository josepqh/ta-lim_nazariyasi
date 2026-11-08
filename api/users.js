const sql = require('./_db');
const { requireUser } = require('./_auth');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

async function getProfile(res, id) {
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Foydalanuvçi raqami nötöğri.' });
  const rows = await sql`
    SELECT id, name, login, role, status, created_at, last_login_at
    FROM np_users WHERE id=${id} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) return res.status(404).json({ error: 'Foydalanuvçi topilmadi.' });

  const modulesCreated = await sql`
    SELECT id, order_num, title FROM np_modules
    WHERE created_by=${id} AND deleted_at IS NULL ORDER BY order_num`;
  return res.json({ ...rows[0], modules_created: modulesCreated });
}

async function listUsers(req, res) {
  const role = req.query.role || null;
  if (role !== null && !['student', 'teacher'].includes(role)) return res.status(400).json({ error: 'Rol nötöğri.' });

  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.query.page_size, 10) || DEFAULT_PAGE_SIZE));
  const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const pattern = search ? `%${escapeLike(search)}%` : null;

  const items = await sql`
    SELECT u.id, u.name, u.login, u.role, u.status, u.created_at, u.last_login_at,
           COALESCE(p.modules_started, 0) AS modules_started,
           COALESCE(p.modules_finished, 0) AS modules_finished,
           COALESCE(p.total_score, 0) AS total_score,
           COALESCE(m.modules_created, 0) AS modules_created,
           COUNT(*) OVER()::int AS full_count
    FROM np_users u
    LEFT JOIN (
      SELECT user_id, COUNT(*)::int AS modules_started,
             (COUNT(*) FILTER (WHERE jsonb_array_length(completed_steps) >= 6))::int AS modules_finished,
             SUM(total_score)::int AS total_score
      FROM np_progress WHERE deleted_at IS NULL GROUP BY user_id
    ) p ON p.user_id = u.id
    LEFT JOIN (
      SELECT created_by, COUNT(*)::int AS modules_created
      FROM np_modules WHERE deleted_at IS NULL GROUP BY created_by
    ) m ON m.created_by = u.id
    WHERE u.deleted_at IS NULL
      AND u.role IN ('student', 'teacher')
      AND (${role}::text IS NULL OR u.role = ${role}::text)
      AND (${pattern}::text IS NULL OR u.name ILIKE ${pattern}::text OR u.login ILIKE ${pattern}::text)
    ORDER BY u.created_at DESC NULLS LAST, u.id DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

  const counts = await sql`
    SELECT role, COUNT(*)::int AS n FROM np_users
    WHERE deleted_at IS NULL AND role IN ('student', 'teacher') GROUP BY role`;

  return res.json({
    items: items.map(({ full_count: _unused, ...user }) => user),
    total: items[0]?.full_count ?? 0,
    page,
    page_size: pageSize,
    counts: Object.fromEntries(counts.map((row) => [row.role, row.n]))
  });
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Ruxsat etilmagan sörov.' });
    const admin = await requireUser(req, res, ['admin']);
    if (!admin) return;
    if (req.query.id !== undefined) return await getProfile(res, Number(req.query.id));
    return await listUsers(req, res);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Serverda içki xato yuz berdi.' });
  }
};
