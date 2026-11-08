const sql = require('./_db');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { hashPassword } = require('./_password');

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

    const adminLogin = process.env.ADMIN_LOGIN || '';
    const adminPassword = process.env.ADMIN_PASSWORD || '';
    const adminName = process.env.ADMIN_NAME || 'Administrator';
    if (!adminLogin || !adminPassword) {
      return res.status(400).json({ error: 'ADMIN_LOGIN va ADMIN_PASSWORD sozlanishi kerak.' });
    }
    if (!/^[\p{L}\p{N}._-]{3,50}$/u.test(adminLogin)) {
      return res.status(400).json({ error: 'ADMIN_LOGIN 3–50 ta harf, raqam, nuqta, _ yoki - dan iborat bo‘lsin.' });
    }
    if (adminPassword.length < 10 || adminPassword.length > 200) {
      return res.status(400).json({ error: 'ADMIN_PASSWORD kamida 10 belgidan iborat bo‘lsin.' });
    }
    if (adminName.length < 2 || adminName.length > 100) {
      return res.status(400).json({ error: 'ADMIN_NAME 2–100 belgidan iborat bo‘lsin.' });
    }

    // 1. Users Table
    await sql`
      CREATE TABLE IF NOT EXISTS np_users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        login VARCHAR(50) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role VARCHAR(20) DEFAULT 'student'
      );
    `;
    await sql`ALTER TABLE np_users ALTER COLUMN password TYPE TEXT`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMPTZ`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;

    // Users Indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_np_users_login ON np_users(login)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_users_role ON np_users(role)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_users_status_deleted ON np_users(status, deleted_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_users_created_at ON np_users(created_at DESC)`;

    // 2. Modules Table
    await sql`
      CREATE TABLE IF NOT EXISTS np_modules (
        id SERIAL PRIMARY KEY,
        order_num INTEGER UNIQUE NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        created_by INTEGER REFERENCES np_users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `;
    await sql`ALTER TABLE np_modules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE np_modules ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;

    // Modules Indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_np_modules_order ON np_modules(order_num)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_modules_created_by ON np_modules(created_by)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_modules_deleted_at ON np_modules(deleted_at)`;

    // 3. Module Content Table (for steps)
    await sql`
      CREATE TABLE IF NOT EXISTS np_module_content (
        id SERIAL PRIMARY KEY,
        module_id INTEGER REFERENCES np_modules(id) ON DELETE CASCADE,
        step_type VARCHAR(50) NOT NULL,
        content JSONB,
        updated_by INTEGER REFERENCES np_users(id),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(module_id, step_type)
      );
    `;

    // Module Content Indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_np_module_content_mod ON np_module_content(module_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_module_content_step ON np_module_content(step_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_module_content_updated_by ON np_module_content(updated_by)`;

    // 4. Progress Table
    await sql`
      CREATE TABLE IF NOT EXISTS np_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES np_users(id) ON DELETE CASCADE,
        module_id INTEGER REFERENCES np_modules(id) ON DELETE CASCADE,
        completed_steps JSONB DEFAULT '[]',
        step_responses JSONB NOT NULL DEFAULT '{}'::jsonb,
        total_score INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, module_id)
      );
    `;
    await sql`ALTER TABLE np_progress ADD COLUMN IF NOT EXISTS step_responses JSONB NOT NULL DEFAULT '{}'::jsonb`;
    await sql`ALTER TABLE np_progress ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE np_progress ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;

    // Progress Indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_np_progress_user_id ON np_progress(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_progress_module_id ON np_progress(module_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_progress_user_mod ON np_progress(user_id, module_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_progress_mod_updated ON np_progress(module_id, updated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_progress_score ON np_progress(total_score DESC)`;

    // 5. Enterprise RBAC Tables
    await sql`
      CREATE TABLE IF NOT EXISTS np_roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        system_type VARCHAR(20) NOT NULL,
        description VARCHAR(255),
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_roles_system_type ON np_roles(system_type)`;

    await sql`
      CREATE TABLE IF NOT EXISTS np_permissions (
        id SERIAL PRIMARY KEY,
        action VARCHAR(50) NOT NULL,
        resource VARCHAR(50) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        description VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(action, resource)
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_permissions_resource ON np_permissions(resource)`;

    await sql`
      CREATE TABLE IF NOT EXISTS np_user_roles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES np_users(id) ON DELETE CASCADE,
        role_id INTEGER REFERENCES np_roles(id) ON DELETE CASCADE,
        assigned_at TIMESTAMPTZ DEFAULT NOW(),
        assigned_by INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
        UNIQUE(user_id, role_id)
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_user_roles_role_id ON np_user_roles(role_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_user_roles_user_id ON np_user_roles(user_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS np_role_permissions (
        id SERIAL PRIMARY KEY,
        role_id INTEGER REFERENCES np_roles(id) ON DELETE CASCADE,
        permission_id INTEGER REFERENCES np_permissions(id) ON DELETE CASCADE,
        assigned_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(role_id, permission_id)
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_role_permissions_role ON np_role_permissions(role_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_role_permissions_perm ON np_role_permissions(permission_id)`;

    // Seed default roles
    await sql`
      INSERT INTO np_roles (name, system_type, description, is_default)
      VALUES 
        ('admin', 'ADMIN', 'Tizim to‘liq boshqaruvchisi', false),
        ('teacher', 'MANAGER', 'O‘qituvchi va kontent moderatori', false),
        ('student', 'CLIENT', 'Talaba va o‘quvchi', true)
      ON CONFLICT (name) DO NOTHING;
    `;

    // 6. Audit Logs Table
    await sql`
      CREATE TABLE IF NOT EXISTS np_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_id INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
        action VARCHAR(50) NOT NULL,
        entity_name VARCHAR(100) NOT NULL,
        entity_id VARCHAR(64),
        old_values JSONB,
        new_values JSONB,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_audit_entity ON np_audit_logs(entity_name, entity_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_audit_actor ON np_audit_logs(actor_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_audit_action_created ON np_audit_logs(action, created_at DESC)`;

    // 7. Sessions Table
    await sql`
      CREATE TABLE IF NOT EXISTS np_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES np_users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) UNIQUE NOT NULL,
        user_agent TEXT,
        ip_address VARCHAR(45),
        device_type VARCHAR(50),
        is_valid BOOLEAN DEFAULT true,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_sessions_active ON np_sessions(user_id, is_valid, expires_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_sessions_token ON np_sessions(token_hash)`;

    // 8. Notifications Table
    await sql`
      CREATE TABLE IF NOT EXISTS np_notifications (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES np_users(id) ON DELETE CASCADE,
        type VARCHAR(50) DEFAULT 'SYSTEM_ALERT',
        priority VARCHAR(20) DEFAULT 'MEDIUM',
        title VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        data JSONB DEFAULT '{}'::jsonb,
        is_read BOOLEAN DEFAULT false,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_notif_user_unread ON np_notifications(user_id, is_read, deleted_at, created_at DESC)`;

    await sql`ALTER TABLE np_modules ALTER COLUMN created_at TYPE TIMESTAMPTZ`;
    await sql`ALTER TABLE np_module_content ALTER COLUMN updated_at TYPE TIMESTAMPTZ`;
    await sql`ALTER TABLE np_progress ALTER COLUMN updated_at TYPE TIMESTAMPTZ`;

    // 9. Uploaded files, stored in chunks so each request fits the serverless body limit.
    await sql`
      CREATE TABLE IF NOT EXISTS np_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
        module_id INTEGER NOT NULL REFERENCES np_modules(id) ON DELETE CASCADE,
        step_type TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('content', 'submission')),
        filename TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
        extension TEXT NOT NULL,
        size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
        total_chunks INTEGER NOT NULL CHECK (total_chunks > 0),
        status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_files_owner_status ON np_files(owner_id, status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_files_module_step ON np_files(module_id, step_type, purpose)`;
    await sql`
      CREATE TABLE IF NOT EXISTS np_file_chunks (
        file_id UUID NOT NULL REFERENCES np_files(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
        data BYTEA NOT NULL,
        PRIMARY KEY (file_id, chunk_index)
      );
    `;

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
    const adminRows = await sql`
      INSERT INTO np_users(name, login, password, role)
      VALUES(${adminName}, ${adminLogin}, ${passwordHash}, 'admin')
      ON CONFLICT(login) DO UPDATE SET name=EXCLUDED.name, password=EXCLUDED.password, role='admin', status='active', deleted_at=NULL, failed_login_count=0, lockout_until=NULL
      RETURNING id`;

    if (adminRows.length) {
      await sql`
        INSERT INTO np_user_roles(user_id, role_id)
        SELECT ${adminRows[0].id}, id FROM np_roles WHERE name='admin'
        ON CONFLICT(user_id, role_id) DO NOTHING`;
    }

    return res.status(200).json({ message: 'Database schema configured.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
