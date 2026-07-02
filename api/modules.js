const sql = require('./_db');

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const modules = await sql`SELECT * FROM np_modules ORDER BY order_num`;
      return res.json(modules);
    }

    if (req.method === 'POST') {
      const { id, title, description, order_num, created_by } = req.body;
      let rows;
      if (id) {
        rows = await sql`
          UPDATE np_modules 
          SET order_num=${order_num}, title=${title}, description=${description} 
          WHERE id=${id} RETURNING *`;
      } else {
        rows = await sql`
          INSERT INTO np_modules(order_num, title, description, created_by)
          VALUES(${order_num}, ${title}, ${description}, ${created_by})
          ON CONFLICT(order_num) DO UPDATE SET title=${title}, description=${description}
          RETURNING *`;
      }
      return res.json(rows[0]);
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
