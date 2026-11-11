const sql = require('../_db');
const { reportServerError } = require('../_errors');
const { requireUser } = require('../_auth');
const mail = require('../_mail');
const storage = require('../_storage');
const { audit } = require('../_audit');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

async function getProfile(res, id) {
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Foydalanuvchi raqami noto‘g‘ri.' });
  const rows = await sql`
    SELECT id, name, login, role, status, created_at, last_login_at
    FROM np_users WHERE id=${id} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });

  const modulesCreated = await sql`
    SELECT id, order_num, title FROM np_modules
    WHERE created_by=${id} AND deleted_at IS NULL ORDER BY order_num`;
  return res.json({ ...rows[0], modules_created: modulesCreated });
}

async function listUsers(req, res) {
  const role = req.query.role || null;
  if (role !== null && !['student', 'teacher'].includes(role)) return res.status(400).json({ error: 'Rol noto‘g‘ri.' });
  // Teachers waiting for approval are listed on their own, never mixed into the regular lists.
  const pending = req.query.status === 'pending';

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
      FROM np_progress
      WHERE deleted_at IS NULL AND module_id IN (SELECT id FROM np_modules WHERE deleted_at IS NULL)
      GROUP BY user_id
    ) p ON p.user_id = u.id
    LEFT JOIN (
      SELECT created_by, COUNT(*)::int AS modules_created
      FROM np_modules WHERE deleted_at IS NULL GROUP BY created_by
    ) m ON m.created_by = u.id
    WHERE u.deleted_at IS NULL
      AND u.role IN ('student', 'teacher')
      AND (${role}::text IS NULL OR u.role = ${role}::text)
      AND (COALESCE(u.status, 'active') = 'pending') = ${pending}::boolean
      AND (${pattern}::text IS NULL OR u.name ILIKE ${pattern}::text OR u.login ILIKE ${pattern}::text)
    ORDER BY u.created_at DESC NULLS LAST, u.id DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

  const counts = await sql`
    SELECT CASE WHEN COALESCE(status, 'active') = 'pending' THEN 'pending' ELSE role END AS role, COUNT(*)::int AS n
    FROM np_users
    WHERE deleted_at IS NULL AND role IN ('student', 'teacher') GROUP BY 1`;

  return res.json({
    items: items.map(({ full_count: _unused, ...user }) => user),
    total: items[0]?.full_count ?? 0,
    page,
    page_size: pageSize,
    counts: Object.fromEntries(counts.map((row) => [row.role, row.n]))
  });
}

async function decideTeacher(res, admin, body) {
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Foydalanuvchi raqami noto‘g‘ri.' });
  const approve = body.action === 'approve';
  // A rejected request leaves nothing behind, so the same Gmail can apply again later.
  const rows = approve
    ? await sql`
        UPDATE np_users SET status='active', updated_at=NOW()
        WHERE id=${id} AND role='teacher' AND status='pending' AND deleted_at IS NULL
        RETURNING id, name, login, role, status`
    : await sql`
        DELETE FROM np_users
        WHERE id=${id} AND role='teacher' AND status='pending' AND deleted_at IS NULL
        RETURNING id, name, login, role`;
  if (!rows.length) return res.status(404).json({ error: 'Tasdiq kutayotgan o‘qituvchi topilmadi.' });
  await mail.sendTeacherDecision(rows[0].login, approve);
  await audit(admin, approve ? 'teacher.approve' : 'teacher.reject', `O‘qituvchi: ${rows[0].name || rows[0].login}`, { user_id: id, login: rows[0].login });
  return res.json({ ...rows[0], decision: approve ? 'approved' : 'rejected' });
}

// Removes a student's or teacher's account for good. Their answers, scores, sessions and uploaded
// answer files go with it; modules a teacher wrote stay for students and pass to the administrator.
async function deleteAccount(res, admin, body) {
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Foydalanuvchi raqami noto‘g‘ri.' });
  if (id === admin.id) return res.status(400).json({ error: 'O‘z hisobingizni bu yerdan o‘chirib bo‘lmaydi.' });

  const rows = await sql`
    SELECT id, name, login, role FROM np_users
    WHERE id=${id} AND role IN ('student', 'teacher') AND deleted_at IS NULL LIMIT 1`;
  const account = rows[0];
  if (!account) return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });

  // One statement, so it runs as a single unit: either everything below happens or nothing does.
  // Foreign keys are checked when the statement ends, after the module links are cleared.
  const [result] = await sql`
    WITH files AS (
      DELETE FROM np_files WHERE owner_id=${id} AND purpose IN ('submission', 'quiz_source') RETURNING storage_path
    ), kept AS (
      UPDATE np_modules SET created_by=NULL WHERE created_by=${id} RETURNING id
    ), edits AS (
      UPDATE np_module_content SET updated_by=NULL WHERE updated_by=${id} RETURNING id
    ), codes AS (
      DELETE FROM np_email_codes WHERE email=${account.login} RETURNING email
    ), removed AS (
      DELETE FROM np_users WHERE id=${id} RETURNING id
    )
    SELECT COALESCE((SELECT json_agg(storage_path) FROM files), '[]'::json) AS paths,
           (SELECT COUNT(*) FROM kept)::int AS modules_kept,
           (SELECT COUNT(*) FROM edits)::int AS edits,
           (SELECT COUNT(*) FROM codes)::int AS codes,
           (SELECT COUNT(*) FROM removed)::int AS removed`;
  if (!result.removed) return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });
  await storage.remove(Array.isArray(result.paths) ? result.paths : JSON.parse(result.paths || '[]'));
  if (account.login.includes('@')) await mail.sendAccountDeleted(account.login);
  await audit(admin, 'account.delete', `${account.role === 'teacher' ? 'O‘qituvchi' : 'Talaba'}: ${account.name || account.login}`, { user_id: id, login: account.login, modules_kept: result.modules_kept });
  return res.json({ id, role: account.role, deleted: true, modules_kept: result.modules_kept });
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });
    const admin = await requireUser(req, res, ['admin']);
    if (!admin) return;
    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (['approve', 'reject'].includes(body.action)) return await decideTeacher(res, admin, body);
      if (body.action === 'delete') return await deleteAccount(res, admin, body);
      return res.status(400).json({ error: 'Noto‘g‘ri so‘rov.' });
    }
    if (req.query.id !== undefined) return await getProfile(res, Number(req.query.id));
    return await listUsers(req, res);
  } catch (error) {
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
