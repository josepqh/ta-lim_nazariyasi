const { createHash } = require('node:crypto');
const sql = require('./_db');

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  return first || req.headers['x-real-ip'] || null;
}

// Counted in the database because serverless instances share no memory.
// Addresses are stored only as hashes.
async function consumeLimit(bucket, limit, windowSeconds) {
  const rows = await sql`
    INSERT INTO np_rate_limits(bucket, window_start, hits)
    VALUES(${bucket}, NOW(), 1)
    ON CONFLICT(bucket) DO UPDATE SET
      hits = CASE WHEN np_rate_limits.window_start <= NOW() - (${windowSeconds}::int * INTERVAL '1 second')
                  THEN 1 ELSE np_rate_limits.hits + 1 END,
      window_start = CASE WHEN np_rate_limits.window_start <= NOW() - (${windowSeconds}::int * INTERVAL '1 second')
                          THEN NOW() ELSE np_rate_limits.window_start END
    RETURNING hits`;
  return rows[0].hits <= limit;
}

async function isWithinLimit(scope, req, limit, windowSeconds) {
  const ip = clientIp(req);
  if (!ip) return true;
  return consumeLimit(`${scope}:${createHash('sha256').update(ip).digest('hex')}`, limit, windowSeconds);
}

module.exports = { consumeLimit, isWithinLimit };
