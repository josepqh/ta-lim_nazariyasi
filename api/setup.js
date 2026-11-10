const sql = require('./_db');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { hashPassword } = require('./_password');
const { normalizeGmail } = require('./_email');
const { migrate } = require('./_migrate');
const storage = require('./_storage');

function hasSetupAccess(req) {
  const expected = process.env.SETUP_SECRET || '';
  const authorization = req.headers.authorization || '';
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expected.length >= 24 && expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });
    if (!hasSetupAccess(req)) return res.status(401).json({ error: 'Sozlash uchun ruxsat yo‘q.' });

    const adminLogin = normalizeGmail(process.env.ADMIN_LOGIN) || process.env.ADMIN_LOGIN || '';
    const adminPassword = process.env.ADMIN_PASSWORD || '';
    const adminName = process.env.ADMIN_NAME || 'Administrator';
    if (!adminLogin || !adminPassword) {
      return res.status(400).json({ error: 'ADMIN_LOGIN va ADMIN_PASSWORD sozlanishi kerak.' });
    }
    if (!normalizeGmail(adminLogin) && !/^[\p{L}\p{N}._-]{3,50}$/u.test(adminLogin)) {
      return res.status(400).json({ error: 'ADMIN_LOGIN 3–50 ta harf, raqam, nuqta, _ yoki - dan iborat bo‘lsin.' });
    }
    if (adminPassword.length < 10 || adminPassword.length > 200) {
      return res.status(400).json({ error: 'ADMIN_PASSWORD kamida 10 belgidan iborat bo‘lsin.' });
    }
    if (adminName.length < 2 || adminName.length > 100) {
      return res.status(400).json({ error: 'ADMIN_NAME 2–100 belgidan iborat bo‘lsin.' });
    }

    const applied = await migrate(sql);
    if (storage.isEnabled()) await storage.ensureBucket();

    // Retire the accounts seeded by the old demo setup; history stays, but they can no longer sign in or be listed.
    const demoAccounts = [
      { login: 'admin', password: 'admin123', name: 'Asosiy Admin' },
      { login: 'teacher', password: 'teacher123', name: 'Bosh Oqituvchi' }
    ];
    for (const demo of demoAccounts) {
      if (demo.login === adminLogin) continue;
      const rows = await sql`
        SELECT id FROM np_users
        WHERE login=${demo.login} AND deleted_at IS NULL
          AND (password=${demo.password} OR name=${demo.name})`;
      if (rows.length) {
        const retired = await hashPassword(randomBytes(32).toString('hex'));
        await sql`UPDATE np_users SET password=${retired}, status='blocked', deleted_at=NOW() WHERE id=${rows[0].id}`;
        await sql`DELETE FROM np_sessions WHERE user_id=${rows[0].id}`;
      }
    }

    // Older accounts may still hold plaintext passwords.
    const plaintextAccounts = await sql`SELECT id, password FROM np_users WHERE password NOT LIKE 'scrypt$%'`;
    for (const account of plaintextAccounts) {
      const migrated = await hashPassword(account.password);
      await sql`UPDATE np_users SET password=${migrated} WHERE id=${account.id}`;
    }

    const passwordHash = await hashPassword(adminPassword);
    await sql`
      INSERT INTO np_users(name, login, password, role)
      VALUES(${adminName}, ${adminLogin}, ${passwordHash}, 'admin')
      ON CONFLICT(login) DO UPDATE SET name=EXCLUDED.name, password=EXCLUDED.password, role='admin', status='active', deleted_at=NULL, failed_login_count=0, lockout_until=NULL`;

    // Supabase can expose public tables through its own API. With RLS on and no policies that path
    // returns nothing, while this server connects as the table owner and is unaffected.
    const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'np\_%'`;
    for (const { tablename } of tables) {
      if (!/^np_[a-z_]+$/.test(tablename)) continue;
      await sql([`ALTER TABLE ${tablename} ENABLE ROW LEVEL SECURITY`]);
    }

    return res.status(200).json({ message: 'Database schema configured.', applied });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
