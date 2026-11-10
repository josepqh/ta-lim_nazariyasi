const sql = require('./_db');

const RETENTION_DAYS = 30;
const clip = (value, length) => (typeof value === 'string' && value ? value.slice(0, length) : null);

// Best effort: a broken log must never turn into a second failure for the visitor.
async function recordError(source, { message, detail, path, userId = null, userAgent }) {
  try {
    await sql`
      INSERT INTO np_error_logs(source, message, detail, path, user_id, user_agent)
      VALUES(${source}, ${clip(message, 1000) || 'Nomaʼlum xato'}, ${clip(detail, 8000)}, ${clip(path, 500)}, ${userId}, ${clip(userAgent, 300)})`;
    if (Math.random() < 0.05) {
      await sql`DELETE FROM np_error_logs WHERE created_at < NOW() - (${RETENTION_DAYS}::int * INTERVAL '1 day')`;
    }
  } catch (error) {
    console.error('Error log unavailable:', error.message);
  }
}

async function reportServerError(error, req) {
  console.error(error);
  const path = (req?.url || '').split('?')[0];
  await recordError('server', {
    message: error?.message || String(error),
    detail: error?.stack,
    path: `${req?.method || ''} ${path}`.trim(),
    userAgent: req?.headers?.['user-agent']
  });
}

module.exports = { recordError, reportServerError };
