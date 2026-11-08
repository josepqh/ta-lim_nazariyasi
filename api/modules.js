const sql = require('./_db');
const { requireUser } = require('./_auth');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      if (req.query.deleted === '1') {
        const staff = await requireUser(req, res, ['teacher', 'admin']);
        if (!staff) return;
        return res.json(await sql`SELECT id, order_num, title, deleted_at FROM np_modules WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`);
      }
      const modules = await sql`SELECT * FROM np_modules WHERE deleted_at IS NULL ORDER BY order_num`;
      return res.json(modules);
    }

    if (req.method === 'POST') {
      const user = await requireUser(req, res, ['teacher', 'admin']);
      if (!user) return;

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (body.action === 'restore') {
        const restoreId = Number(body.id);
        if (!Number.isSafeInteger(restoreId) || restoreId < 1) return res.status(400).json({ error: 'Modul raqami noto‘g‘ri.' });
        const restored = await sql`UPDATE np_modules SET deleted_at=NULL, updated_at=NOW() WHERE id=${restoreId} AND deleted_at IS NOT NULL RETURNING *`;
        if (!restored.length) return res.status(404).json({ error: 'Modul topilmadi.' });
        return res.json(restored[0]);
      }

      const id = body.id === undefined || body.id === null || body.id === '' ? null : Number(body.id);
      const orderNum = Number(body.order_num);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (id !== null && (!Number.isSafeInteger(id) || id < 1)) return res.status(400).json({ error: 'Modul raqami noto‘g‘ri.' });
      if (!Number.isSafeInteger(orderNum) || orderNum < 1) return res.status(400).json({ error: 'Tartib raqami musbat butun son bo‘lsin.' });
      if (!title || title.length > 200) return res.status(400).json({ error: 'Modul nomi 1–200 belgidan iborat bo‘lsin.' });
      if (description.length > 5000) return res.status(400).json({ error: 'Modul ta’rifi juda uzun.' });

      let rows;
      if (id) {
        rows = await sql`
          UPDATE np_modules 
          SET order_num=${orderNum}, title=${title}, description=${description}, updated_at=NOW()
          WHERE id=${id} AND deleted_at IS NULL RETURNING *`;
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
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Modul raqami noto‘g‘ri.' });

      // Soft delete: student work stays and the module can be restored.
      const deleted = await sql`UPDATE np_modules SET deleted_at=NOW(), updated_at=NOW() WHERE id=${id} AND deleted_at IS NULL RETURNING id`;
      if (!deleted.length) return res.status(404).json({ error: 'Modul topilmadi.' });
      return res.json({ ok: true, id });
    }

    return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Bu tartib raqamli modul allaqachon bor.' });
    console.error(error);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
