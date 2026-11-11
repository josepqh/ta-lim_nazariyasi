const sql = require('../_db');
const { reportServerError } = require('../_errors');

// The real numbers for the home page. Cached at the edge for a few minutes: they move slowly.
module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });
    const [row] = await sql`
      SELECT
        (SELECT COUNT(*) FROM np_modules WHERE deleted_at IS NULL)::int AS modules,
        (SELECT COUNT(*) FROM np_users WHERE role='student' AND deleted_at IS NULL)::int AS students,
        (SELECT COUNT(*) FROM np_users WHERE role='teacher' AND deleted_at IS NULL AND COALESCE(status, 'active') <> 'pending')::int AS teachers,
        (SELECT COUNT(*) FROM np_certificates)::int AS certificates`;
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    return res.json(row);
  } catch (error) {
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
