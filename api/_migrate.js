const MIGRATIONS = require('./_migrations');

// Runs every migration that has not run yet, each in its own transaction.
async function migrate(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS np_schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  const done = new Set((await sql`SELECT version FROM np_schema_migrations`).map((row) => row.version));
  const applied = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.version)) continue;
    await sql`BEGIN`;
    try {
      await migration.up(sql);
      await sql`INSERT INTO np_schema_migrations(version) VALUES(${migration.version})`;
      await sql`COMMIT`;
    } catch (error) {
      await sql`ROLLBACK`;
      throw new Error(`Migration ${migration.version} failed: ${error.message}`);
    }
    applied.push(migration.version);
  }
  return applied;
}

module.exports = { migrate };
