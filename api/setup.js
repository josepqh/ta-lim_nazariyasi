const sql = require('./_db');

module.exports = async (req, res) => {
  try {
    // 1. Users Table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        login VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(50) NOT NULL,
        role VARCHAR(20) DEFAULT 'student'
      );
    `;

    // 2. Modules Table
    await sql`
      CREATE TABLE IF NOT EXISTS modules (
        id SERIAL PRIMARY KEY,
        order_num INTEGER UNIQUE NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `;

    // 3. Module Content Table (for steps)
    await sql`
      CREATE TABLE IF NOT EXISTS module_content (
        id SERIAL PRIMARY KEY,
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        step_type VARCHAR(50) NOT NULL,
        content JSONB,
        updated_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(module_id, step_type)
      );
    `;

    // 4. Progress Table
    await sql`
      CREATE TABLE IF NOT EXISTS progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        completed_steps JSONB DEFAULT '[]',
        total_score INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, module_id)
      );
    `;

    return res.status(200).json({ message: "Database schema setup successfully." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
