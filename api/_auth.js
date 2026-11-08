const { createHash, randomBytes } = require('node:crypto');
const sql = require('./_db');

const COOKIE_NAME = 'np_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function cookieFlags(req) {
  const secure = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
  return `HttpOnly; SameSite=Lax; Path=/${secure ? '; Secure' : ''}`;
}

function readToken(req) {
  const match = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([\\w-]{43})(?:;|$)`));
  return match ? match[1] : null;
}

async function createSession(req, res, user) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await sql`DELETE FROM np_sessions WHERE user_id=${user.id} AND (expires_at <= NOW() OR NOT is_valid)`;
  await sql`INSERT INTO np_sessions(user_id, token_hash, expires_at) VALUES(${user.id}, ${hashToken(token)}, ${expiresAt})`;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; ${cookieFlags(req)}; Max-Age=${SESSION_TTL_SECONDS}`);
}

async function destroySession(req, res) {
  const token = readToken(req);
  if (token) await sql`DELETE FROM np_sessions WHERE token_hash=${hashToken(token)}`;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${cookieFlags(req)}; Max-Age=0`);
}

// Every request re-reads the account, so role changes and blocks apply immediately.
async function getSessionUser(req) {
  const token = readToken(req);
  if (!token) return null;
  const rows = await sql`
    SELECT u.id, u.name, u.login, u.role
    FROM np_sessions s
    JOIN np_users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)}
      AND s.is_valid
      AND s.expires_at > NOW()
      AND u.deleted_at IS NULL
      AND COALESCE(u.status, 'active') = 'active'
    LIMIT 1`;
  return rows[0] || null;
}

async function requireUser(req, res, roles) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Tizimga qayta kiring.' });
    return null;
  }
  if (roles && !roles.includes(user.role)) {
    res.status(403).json({ error: 'Bu amal uçun ruxsat yöq.' });
    return null;
  }
  return user;
}

module.exports = { createSession, destroySession, getSessionUser, requireUser };
