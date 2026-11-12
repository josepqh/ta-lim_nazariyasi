const sql = require('../_db');
const { requireUser } = require('../_auth');
const { CODE_LENGTH, syncCertificate } = require('../_certificates');
const { normalizeCode } = require('../_codes');
const { reportServerError } = require('../_errors');
const { isWithinLimit } = require('../_rateLimit');

const MAX_CHECKS_PER_HOUR = 120;

// GET ?code=… is the public check anyone can run on a certificate; GET without it lists a student's own.
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });

    if (req.query.code !== undefined) {
      if (!(await isWithinLimit('certificate-check', req, MAX_CHECKS_PER_HOUR, 3600))) {
        return res.status(429).json({ error: 'Juda ko‘p tekshiruv. Birozdan keyin urinib ko‘ring.' });
      }
      const code = normalizeCode(req.query.code);
      const rows = code.length === CODE_LENGTH
        ? await sql`SELECT code, student_name, module_title, percent, grade, issued_at FROM np_certificates WHERE code=${code} LIMIT 1`
        : [];
      return res.json(rows.length ? { valid: true, ...rows[0] } : { valid: false });
    }

    const user = await requireUser(req, res, ['student']);
    if (!user) return;
    // Modules finished before certificates existed, or graded since, are brought up to date here.
    const finished = await sql`
      SELECT module_id FROM np_progress
      WHERE user_id=${user.id} AND jsonb_array_length(completed_steps) >= 6
        AND module_id IN (SELECT id FROM np_modules WHERE deleted_at IS NULL)`;
    const certificates = [];
    for (const row of finished) {
      const { certificate } = await syncCertificate(user.id, row.module_id);
      if (certificate) certificates.push(certificate);
    }
    return res.json(certificates);
  } catch (error) {
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
