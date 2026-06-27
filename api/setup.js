const sql = require('./_db');

module.exports = async (req, res) => {
  try {
    // 1. Users Table
    await sql`
      CREATE TABLE IF NOT EXISTS np_users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        login VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(50) NOT NULL,
        role VARCHAR(20) DEFAULT 'student'
      );
    `;

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

    // 4. Progress Table
    await sql`
      CREATE TABLE IF NOT EXISTS np_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES np_users(id) ON DELETE CASCADE,
        module_id INTEGER REFERENCES np_modules(id) ON DELETE CASCADE,
        completed_steps JSONB DEFAULT '[]',
        total_score INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, module_id)
      );
    `;
    
    // 5. Insert default Admin and Teacher if not exist, force update password if exists
    await sql`
      INSERT INTO np_users(name, login, password, role) 
      VALUES('Asosiy Admin', 'admin', 'admin123', 'admin')
      ON CONFLICT(login) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role;
    `;
    await sql`
      INSERT INTO np_users(name, login, password, role) 
      VALUES('Bosh Oqituvchi', 'teacher', 'teacher123', 'teacher')
      ON CONFLICT(login) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role;
    `;

    return res.status(200).json({ message: "Database schema setup successfully." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
