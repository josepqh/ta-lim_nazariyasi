const sql = require('../_db');
const { requireUser } = require('../_auth');
const { reportServerError } = require('../_errors');

const PAGE_SIZE = 50;

// The administrator's record of approvals, deletions and content changes.
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });
    const admin = await requireUser(req, res, ['admin']);
    if (!admin) return;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const items = await sql`
      SELECT id, created_at, actor_name, actor_role, action, target, detail, COUNT(*) OVER()::int AS full_count
      FROM np_audit_log ORDER BY created_at DESC, id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`;
    return res.json({
      items: items.map(({ full_count: _unused, ...item }) => item),
      total: items[0]?.full_count ?? 0,
      page,
      page_size: PAGE_SIZE
    });
  } catch (error) {
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
