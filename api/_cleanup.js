const sql = require('./_db');

// Roughly one request in two hundred also clears rows nobody will read again, so the tables
// stay small without a scheduled job. Best effort: a failed sweep never fails the request.
const SWEEP_CHANCE = 0.005;

async function sweepExpiredRows({ force = false } = {}) {
  if (!force && Math.random() >= SWEEP_CHANCE) return;
  try {
    await sql`DELETE FROM np_rate_limits WHERE window_start < NOW() - INTERVAL '1 day'`;
    await sql`DELETE FROM np_email_codes WHERE expires_at < NOW() - INTERVAL '1 day'`;
    await sql`DELETE FROM np_sessions WHERE expires_at < NOW() - INTERVAL '1 day'`;
  } catch (error) {
    console.error('Cleanup skipped:', error.message);
  }
}

module.exports = { sweepExpiredRows };
