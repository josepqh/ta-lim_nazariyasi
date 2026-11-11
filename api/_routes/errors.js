const sql = require('../_db');
const { getSessionUser, requireUser } = require('../_auth');
const { recordError } = require('../_errors');
const { isWithinLimit } = require('../_rateLimit');

const MAX_REPORTS_PER_HOUR = 30;
const PAGE_SIZE = 50;

// Browsers report their own errors here; only the administrator can read or clear the log.
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (typeof body.message !== 'string' || !body.message.trim()) return res.status(400).json({ error: 'Xato matni yo‘q.' });
      if (!(await isWithinLimit('client-error', req, MAX_REPORTS_PER_HOUR, 3600))) return res.status(429).json({ error: 'Juda ko‘p xabar.' });
      const user = await getSessionUser(req);
      await recordError('client', {
        message: body.message.trim(),
        detail: typeof body.detail === 'string' ? body.detail : null,
        path: typeof body.path === 'string' ? body.path : null,
        userId: user?.id ?? null,
        userAgent: req.headers['user-agent']
      });
      return res.status(202).json({ ok: true });
    }

    const admin = await requireUser(req, res, ['admin']);
    if (!admin) return;
    if (req.method === 'DELETE') {
      await sql`DELETE FROM np_error_logs`;
      return res.json({ ok: true });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const items = await sql`
      SELECT e.id, e.created_at, e.source, e.message, e.detail, e.path, e.user_agent, u.name AS user_name,
             COUNT(*) OVER()::int AS full_count
      FROM np_error_logs e LEFT JOIN np_users u ON u.id = e.user_id
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`;
    const [{ last_day: lastDay }] = await sql`SELECT COUNT(*)::int AS last_day FROM np_error_logs WHERE created_at > NOW() - INTERVAL '1 day'`;
    return res.json({
      items: items.map(({ full_count: _unused, ...item }) => item),
      total: items[0]?.full_count ?? 0,
      last_day: lastDay,
      page,
      page_size: PAGE_SIZE
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
