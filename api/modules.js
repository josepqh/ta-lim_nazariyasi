const sql = require('./_db');
const { requireUser } = require('./_auth');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const modules = await sql`SELECT * FROM np_modules WHERE deleted_at IS NULL ORDER BY order_num`;
      return res.json(modules);
    }

    if (req.method === 'POST') {
      const user = await requireUser(req, res, ['teacher', 'admin']);
      if (!user) return;

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const id = body.id === undefined || body.id === null || body.id === '' ? null : Number(body.id);
      const orderNum = Number(body.order_num);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (id !== null && (!Number.isSafeInteger(id) || id < 1)) return res.status(400).json({ error: 'Modul raqami nötöğri.' });
      if (!Number.isSafeInteger(orderNum) || orderNum < 1) return res.status(400).json({ error: 'Tartib raqami musbat butun son bölsin.' });
      if (!title || title.length > 200) return res.status(400).json({ error: 'Modul nomi 1–200 belgidan iborat bölsin.' });
      if (description.length > 5000) return res.status(400).json({ error: 'Modul ta’rifi juda uzun.' });

      let rows;
      if (id) {
        rows = await sql`
          UPDATE np_modules 
          SET order_num=${orderNum}, title=${title}, description=${description}, updated_at=NOW()
          WHERE id=${id} RETURNING *`;
        if (!rows.length) return res.status(404).json({ error: 'Modul topilmadi.' });
      } else {
        rows = await sql`
          INSERT INTO np_modules(order_num, title, description, created_by)
          VALUES(${orderNum}, ${title}, ${description}, ${user.id})
          RETURNING *`;
      }
      return res.json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const user = await requireUser(req, res, ['teacher', 'admin']);
      if (!user) return;

      const id = Number(req.query.id || (req.body && typeof req.body === 'object' ? req.body.id : null));
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Modul raqami nötöğri.' });

      const deleted = await sql`DELETE FROM np_modules WHERE id=${id} RETURNING id`;
      if (!deleted.length) return res.status(404).json({ error: 'Modul topilmadi.' });
      return res.json({ ok: true, id });
    }

    return res.status(405).json({ error: 'Ruxsat etilmagan sörov.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Bu tartib raqamli modul allaqaçon bor.' });
    console.error(error);
    return res.status(500).json({ error: 'Serverda içki xato yuz berdi.' });
  }
};
