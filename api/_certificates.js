const sql = require('./_db');
const { randomCode } = require('./_codes');
const { moduleResult } = require('./_grading');

const CODE_LENGTH = 10;

async function findCertificate(userId, moduleId) {
  const rows = await sql`
    SELECT code, module_id, student_name, module_title, score, percent, grade, issued_at
    FROM np_certificates WHERE user_id=${userId} AND module_id=${moduleId}`;
  return rows[0] || null;
}

// Brings a student's certificate for one module in line with their result, and returns both.
// A certificate is issued once the module is finished, the teacher has scored the written
// steps and the result passes; afterwards its grade follows the result (a better retake, a
// changed score) while its number stays the same. Name and title are copied in at issue, so a
// renamed module or student does not change a certificate already given.
async function syncCertificate(userId, moduleId) {
  const rows = await sql`
    SELECT p.completed_steps, p.step_responses, p.total_score, u.name, u.login, m.title
    FROM np_progress p JOIN np_users u ON u.id = p.user_id JOIN np_modules m ON m.id = p.module_id
    WHERE p.user_id=${userId} AND p.module_id=${moduleId} AND m.deleted_at IS NULL LIMIT 1`;
  if (!rows.length) return { certificate: null, result: null };
  const progress = rows[0];
  const result = moduleResult(progress);
  const existing = await findCertificate(userId, moduleId);

  if (existing) {
    if (result.percent === null || (existing.percent === result.percent && existing.grade === result.grade)) {
      return { certificate: existing, result };
    }
    await sql`UPDATE np_certificates SET percent=${result.percent}, grade=${result.grade} WHERE code=${existing.code}`;
    return { certificate: { ...existing, percent: result.percent, grade: result.grade }, result };
  }
  if (!result.passed) return { certificate: null, result };

  for (let attempt = 0; attempt < 5; attempt++) {
    const inserted = await sql`
      INSERT INTO np_certificates(code, user_id, module_id, student_name, module_title, score, percent, grade)
      VALUES(${randomCode(CODE_LENGTH)}, ${userId}, ${moduleId}, ${progress.name || progress.login}, ${progress.title},
             ${Number(progress.total_score) || 0}, ${result.percent}, ${result.grade})
      ON CONFLICT (user_id, module_id) DO NOTHING
      RETURNING code`;
    if (inserted.length || (await findCertificate(userId, moduleId))) break;
    // Otherwise the random code itself collided; try another.
  }
  return { certificate: await findCertificate(userId, moduleId), result };
}

module.exports = { CODE_LENGTH, syncCertificate };
