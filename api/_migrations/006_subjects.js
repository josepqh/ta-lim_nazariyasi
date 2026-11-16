// Subjects group the modules: a student opens a subject (Ta’lim nazariyasi, Neyropedagogika…)
// and then its modules. Every existing module moves into the first subject, and an active
// module's position number is now unique within its subject instead of across the whole site.
const FIRST_SUBJECTS = [
  ['Ta’lim nazariyasi', 'Didaktika: ta’lim jarayonining qonuniyatlari, tamoyillari, metodlari va baholash.'],
  ['Neyropedagogika', 'Miya qanday o‘rganishini bilib, darsni shunga mos tashkil etish.']
];

module.exports = {
  version: '006_subjects',
  async up(sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS np_subjects (
        id SERIAL PRIMARY KEY,
        order_num INTEGER NOT NULL CHECK (order_num > 0),
        title TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
        description TEXT NOT NULL DEFAULT '',
        cover_image_id UUID REFERENCES np_images(id) ON DELETE SET NULL,
        created_by INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_np_subjects_title ON np_subjects(lower(title)) WHERE deleted_at IS NULL`;

    const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM np_subjects`;
    if (!n) {
      for (const [index, [title, description]] of FIRST_SUBJECTS.entries()) {
        await sql`INSERT INTO np_subjects(order_num, title, description) VALUES(${index + 1}, ${title}, ${description})`;
      }
    }

    await sql`ALTER TABLE np_modules ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES np_subjects(id)`;
    await sql`
      UPDATE np_modules SET subject_id = (SELECT id FROM np_subjects ORDER BY order_num, id LIMIT 1)
      WHERE subject_id IS NULL`;
    await sql`ALTER TABLE np_modules ALTER COLUMN subject_id SET NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_modules_subject ON np_modules(subject_id)`;

    // Active modules keep distinct positions within their subject; deleted ones free theirs.
    await sql`DROP INDEX IF EXISTS uq_np_modules_active_order`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_np_modules_subject_order ON np_modules(subject_id, order_num) WHERE deleted_at IS NULL`;
  }
};
