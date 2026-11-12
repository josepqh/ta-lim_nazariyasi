const { createHash } = require('node:crypto');
const sql = require('./_db');
const { sweepExpiredRows } = require('./_cleanup');

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
  await sweepExpiredRows();
  return rows[0].hits <= limit;
}

async function isWithinLimit(scope, req, limit, windowSeconds) {
  const ip = clientIp(req);
  if (!ip) return true;
  return consumeLimit(`${scope}:${createHash('sha256').update(ip).digest('hex')}`, limit, windowSeconds);
}

// The caller's address as a short hash, or 'unknown' when the platform does not pass one.
function addressKey(req) {
  const ip = clientIp(req);
  return ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : 'unknown';
}

// How many hits a bucket has in its current window, without adding one.
async function hitsIn(bucket, windowSeconds) {
  const rows = await sql`
    SELECT hits FROM np_rate_limits
    WHERE bucket=${bucket} AND window_start > NOW() - (${windowSeconds}::int * INTERVAL '1 second')`;
  return rows.length ? Number(rows[0].hits) : 0;
}

async function resetLimit(bucket) {
  await sql`DELETE FROM np_rate_limits WHERE bucket=${bucket}`;
}

module.exports = { addressKey, consumeLimit, hitsIn, isWithinLimit, resetLimit };
