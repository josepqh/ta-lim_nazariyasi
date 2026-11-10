// Baseline: the schema as it stood before versioned migrations. Every statement is
// idempotent, so it applies cleanly to databases created by the old setup script.
module.exports = {
  version: '001_baseline',
  async up(sql) {
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
    await sql`ALTER TABLE np_users ALTER COLUMN login TYPE TEXT`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMPTZ`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE np_users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;

    // Users Indexes
    await sql`DROP INDEX IF EXISTS idx_np_users_login`;
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
    await sql`DROP INDEX IF EXISTS idx_np_modules_order`;
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
    await sql`DROP INDEX IF EXISTS idx_np_progress_user_mod`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_progress_mod_updated ON np_progress(module_id, updated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_progress_score ON np_progress(total_score DESC)`;

    // Tables from an abandoned design; the application never used them.
    for (const statement of [
      sql`DROP TABLE IF EXISTS np_role_permissions`,
      sql`DROP TABLE IF EXISTS np_user_roles`,
      sql`DROP TABLE IF EXISTS np_permissions`,
      sql`DROP TABLE IF EXISTS np_roles`,
      sql`DROP TABLE IF EXISTS np_audit_logs`,
      sql`DROP TABLE IF EXISTS np_notifications`
    ]) await statement;

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
    await sql`DROP INDEX IF EXISTS idx_np_sessions_token`;

    await sql`ALTER TABLE np_modules ALTER COLUMN created_at TYPE TIMESTAMPTZ`;
    await sql`ALTER TABLE np_module_content ALTER COLUMN updated_at TYPE TIMESTAMPTZ`;
    await sql`ALTER TABLE np_progress ALTER COLUMN updated_at TYPE TIMESTAMPTZ`;

    // Deleted modules keep their row, so only active ones must have a unique position.
    await sql`ALTER TABLE np_modules DROP CONSTRAINT IF EXISTS np_modules_order_num_key`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_np_modules_active_order ON np_modules(order_num) WHERE deleted_at IS NULL`;

    await sql`
      CREATE TABLE IF NOT EXISTS np_rate_limits (
        bucket TEXT PRIMARY KEY,
        window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        hits INTEGER NOT NULL DEFAULT 0
      );
    `;
    await sql`DELETE FROM np_rate_limits WHERE window_start < NOW() - INTERVAL '1 day'`;

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

    // One pending email code per mailbox and purpose; the account is created only after it is confirmed.
    await sql`
      CREATE TABLE IF NOT EXISTS np_email_codes (
        email TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('register', 'reset')),
        code_hash TEXT NOT NULL,
        payload JSONB,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ NOT NULL,
        last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (email, purpose)
      );
    `;
    await sql`DELETE FROM np_email_codes WHERE expires_at < NOW() - INTERVAL '1 day'`;

    // Files read to build a quiz exist before their module does.
    await sql`ALTER TABLE np_files ALTER COLUMN module_id DROP NOT NULL`;
    await sql`ALTER TABLE np_files DROP CONSTRAINT IF EXISTS np_files_purpose_check`;
    await sql`ALTER TABLE np_files ADD CONSTRAINT np_files_purpose_check CHECK (purpose IN ('content', 'submission', 'quiz_source'))`;
  }
};
