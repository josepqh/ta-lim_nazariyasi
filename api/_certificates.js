const sql = require('./_db');
const { randomCode } = require('./_codes');

const CODE_LENGTH = 10;

// Issues the certificate for a finished module once; later calls return the same one.
// Name and title are copied in, so a renamed module or student does not change a certificate already given.
async function ensureCertificate(userId, moduleId) {
  const done = await sql`
    SELECT p.total_score, u.name, u.login, m.title
    FROM np_progress p JOIN np_users u ON u.id = p.user_id JOIN np_modules m ON m.id = p.module_id
    WHERE p.user_id=${userId} AND p.module_id=${moduleId} AND jsonb_array_length(p.completed_steps) >= 6
      AND m.deleted_at IS NULL LIMIT 1`;
  if (!done.length) return null;
  const { total_score: score, name, login, title } = done[0];
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await sql`
      INSERT INTO np_certificates(code, user_id, module_id, student_name, module_title, score)
      VALUES(${randomCode(CODE_LENGTH)}, ${userId}, ${moduleId}, ${name || login}, ${title}, ${Number(score) || 0})
      ON CONFLICT (user_id, module_id) DO NOTHING
      RETURNING code`;
    if (rows.length) break;
    const existing = await sql`SELECT code FROM np_certificates WHERE user_id=${userId} AND module_id=${moduleId}`;
    if (existing.length) break;
    // Otherwise the random code itself collided; try another.
  }
  const [certificate] = await sql`
    SELECT code, module_id, student_name, module_title, score, issued_at
    FROM np_certificates WHERE user_id=${userId} AND module_id=${moduleId}`;
  return certificate || null;
}

module.exports = { CODE_LENGTH, ensureCertificate };
