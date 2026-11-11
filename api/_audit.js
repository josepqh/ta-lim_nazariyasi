const sql = require('./_db');

// Who did what to whom. Best effort: a missing log entry must never undo the action itself.
async function audit(actor, action, target, detail = null) {
  try {
    await sql`
      INSERT INTO np_audit_log(actor_id, actor_name, actor_role, action, target, detail)
      VALUES(${actor?.id ?? null}, ${actor ? actor.name || actor.login : null}, ${actor?.role ?? null}, ${action}, ${target}, ${detail ? JSON.stringify(detail) : null})`;
  } catch (error) {
    console.error('Audit log unavailable:', error.message);
  }
}

module.exports = { audit };
