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
      const { module_id } = req.query;
      const rows = await sql`SELECT * FROM np_module_content WHERE module_id=${module_id} ORDER BY step_order`;
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const { module_id, step_type, content, updated_by } = req.body;
      const rows = await sql`
        INSERT INTO np_module_content(module_id, step_type, content, updated_by)
        VALUES(${module_id}, ${step_type}, ${JSON.stringify(content)}, ${updated_by})
        ON CONFLICT(module_id, step_type) DO UPDATE
          SET content=${JSON.stringify(content)}, updated_by=${updated_by}, updated_at=NOW()
        RETURNING *`;
      return res.json(rows[0]);
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
