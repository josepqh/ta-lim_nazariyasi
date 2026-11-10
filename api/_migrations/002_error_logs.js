// Server and browser errors, kept for 30 days so the administrator can see what broke.
module.exports = {
  version: '002_error_logs',
  async up(sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS np_error_logs (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source TEXT NOT NULL CHECK (source IN ('server', 'client')),
        message TEXT NOT NULL,
        detail TEXT,
        path TEXT,
        user_id INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
        user_agent TEXT
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_error_logs_created ON np_error_logs(created_at DESC)`;
  }
};
