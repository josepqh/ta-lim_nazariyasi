const GUIDES = [
  ['darsni-rejalashtirish', 'Darsni rejalashtirish', 'Aniq o‘quv maqsadini belgilang, mazmun va mashqlarni shu maqsadga moslang.'],
  ['faol-organish', 'Faol o‘rganish', 'Savol, bahs-munozara va amaliy mashqlar orqali o‘quvchini dars jarayoniga jalb qiling.'],
  ['oquv-natijalarini-baholash', 'O‘quv natijalarini baholash', 'Baholash mezonlarini oldindan tushuntiring va natijaga konstruktiv fikr-mulohaza qo‘shing.'],
  ['refleksiya-va-rivojlanish', 'Refleksiya va o‘z-o‘zini rivojlantirish', 'Darsdan keyin nimalar samarali ishlaganini ko‘rib chiqing va keyingi mashg‘ulotni shunga qarab boyiting.']
];

// Groups, certificates, the action log, images (module and article covers) and articles.
module.exports = {
  version: '004_learning_features',
  async up(sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS np_groups (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
        teacher_id INTEGER NOT NULL REFERENCES np_users(id) ON DELETE CASCADE,
        code TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_groups_teacher ON np_groups(teacher_id)`;
    await sql`
      CREATE TABLE IF NOT EXISTS np_group_members (
        group_id INTEGER NOT NULL REFERENCES np_groups(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES np_users(id) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (group_id, user_id)
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_group_members_user ON np_group_members(user_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS np_certificates (
        code TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES np_users(id) ON DELETE CASCADE,
        module_id INTEGER NOT NULL REFERENCES np_modules(id) ON DELETE CASCADE,
        student_name TEXT NOT NULL,
        module_title TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, module_id)
      )`;

    await sql`
      CREATE TABLE IF NOT EXISTS np_audit_log (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor_id INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
        actor_name TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        target TEXT,
        detail JSONB
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_audit_log_created ON np_audit_log(created_at DESC)`;

    await sql`
      CREATE TABLE IF NOT EXISTS np_images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
        mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
        data BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`ALTER TABLE np_modules ADD COLUMN IF NOT EXISTS cover_image_id UUID REFERENCES np_images(id) ON DELETE SET NULL`;

    await sql`
      CREATE TABLE IF NOT EXISTS np_articles (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
        excerpt TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        cover_image_id UUID REFERENCES np_images(id) ON DELETE SET NULL,
        author_id INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
        published BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_np_articles_published ON np_articles(published, created_at DESC)`;
    // The four guides the site used to hard-code become its first articles.
    const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM np_articles`;
    if (!n) {
      for (const [slug, title, text] of GUIDES) {
        await sql`INSERT INTO np_articles(slug, title, excerpt, body) VALUES(${slug}, ${title}, ${text}, ${text})`;
      }
    }
  }
};
