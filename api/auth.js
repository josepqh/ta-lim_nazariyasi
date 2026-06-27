const sql = require('./_db');

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, login, password, name, role } = req.body || {};

  try {
    if (action === 'login') {
      const rows = await sql`SELECT id, name, login, role FROM users WHERE login=${login} AND password=${password}`;
      if (!rows.length) return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
      return res.json(rows[0]);
    }

    if (action === 'register') {
      const exists = await sql`SELECT id FROM users WHERE login=${login}`;
      if (exists.length) return res.status(400).json({ error: 'Bu login band, boshqa tanlang' });
      const rows = await sql`INSERT INTO users(name,login,password,role) VALUES(${name},${login},${password},${role||'student'}) RETURNING id,name,login,role`;
      return res.json(rows[0]);
    }

    return res.status(400).json({ error: 'Noto\'g\'ri so\'rov' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
