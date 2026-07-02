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
      const { user_id, module_id } = req.query;
      let query;
      if (module_id) {
         query = sql`SELECT * FROM np_progress WHERE user_id=${user_id} AND module_id=${module_id}`;
      } else {
         query = sql`SELECT * FROM np_progress WHERE user_id=${user_id}`;
      }
      const rows = await query;
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const { user_id, module_id, step_type, score } = req.body;
      // Get current progress
      const current = await sql`SELECT completed_steps, total_score FROM np_progress WHERE user_id=${user_id} AND module_id=${module_id}`;
      
      let steps = [];
      let newScore = score || 0;

      if (current.length > 0) {
        steps = current[0].completed_steps || [];
        if (!steps.includes(step_type)) {
           steps.push(step_type);
           newScore += (current[0].total_score || 0);
        } else {
           return res.json(current[0]); // Already completed
        }
      } else {
        steps = [step_type];
      }

      const rows = await sql`
        INSERT INTO np_progress(user_id, module_id, completed_steps, total_score)
        VALUES(${user_id}, ${module_id}, ${JSON.stringify(steps)}, ${newScore})
        ON CONFLICT(user_id, module_id) DO UPDATE
          SET completed_steps=${JSON.stringify(steps)}, total_score=${newScore}, updated_at=NOW()
        RETURNING *`;
      return res.json(rows[0]);
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
