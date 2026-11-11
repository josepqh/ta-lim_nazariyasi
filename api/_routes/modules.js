const sql = require('../_db');
const { reportServerError } = require('../_errors');
const { requireUser } = require('../_auth');
const { loadManagedModule } = require('../_modules');
const { audit } = require('../_audit');
const { isUuid } = require('../_files');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      if (req.query.deleted === '1') {
        const staff = await requireUser(req, res, ['teacher', 'admin']);
        if (!staff) return;
        // Teachers see and restore only their own deleted modules.
        return res.json(await sql`
          SELECT id, order_num, title, created_by, deleted_at FROM np_modules
          WHERE deleted_at IS NOT NULL AND (${staff.role === 'admin'}::boolean OR created_by=${staff.id})
          ORDER BY deleted_at DESC`);
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
        if (!(await loadManagedModule(res, user, restoreId, { deleted: true }))) return;
        const restored = await sql`UPDATE np_modules SET deleted_at=NULL, updated_at=NOW() WHERE id=${restoreId} AND deleted_at IS NOT NULL RETURNING *`;
        if (!restored.length) return res.status(404).json({ error: 'Modul topilmadi.' });
        await audit(user, 'module.restore', `Modul: ${restored[0].title}`, { module_id: restoreId });
        return res.json(restored[0]);
      }

      // The cover is changed on its own, so editing the title never drops a picture by accident.
      if (body.action === 'cover') {
        const coverId = Number(body.id);
        const cover = body.cover_image_id ?? null;
        if (cover !== null && !isUuid(cover)) return res.status(400).json({ error: 'Muqova rasmi noto‘g‘ri.' });
        if (!(await loadManagedModule(res, user, coverId))) return;
        const [old] = await sql`SELECT cover_image_id, title FROM np_modules WHERE id=${coverId}`;
        const [row] = await sql`UPDATE np_modules SET cover_image_id=${cover}, updated_at=NOW() WHERE id=${coverId} RETURNING *`;
        if (old.cover_image_id && old.cover_image_id !== cover) await sql`DELETE FROM np_images WHERE id=${old.cover_image_id}::uuid`;
        await audit(user, cover ? 'module.cover' : 'module.cover_remove', `Modul: ${old.title}`, { module_id: coverId });
        return res.json(row);
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
        if (!(await loadManagedModule(res, user, id))) return;
        rows = await sql`
          UPDATE np_modules 
          SET order_num=${orderNum}, title=${title}, description=${description}, updated_at=NOW()
          WHERE id=${id} AND deleted_at IS NULL RETURNING *`;
        if (!rows.length) return res.status(404).json({ error: 'Modul topilmadi.' });
        await audit(user, 'module.update', `Modul: ${title}`, { module_id: id });
      } else {
        const cover = isUuid(body.cover_image_id) ? body.cover_image_id : null;
        rows = await sql`
          INSERT INTO np_modules(order_num, title, description, created_by, cover_image_id)
          VALUES(${orderNum}, ${title}, ${description}, ${user.id}, ${cover})
          RETURNING *`;
        await audit(user, 'module.create', `Modul: ${title}`, { module_id: rows[0].id });
      }
      return res.json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const user = await requireUser(req, res, ['teacher', 'admin']);
      if (!user) return;

      const id = Number(req.query.id || (req.body && typeof req.body === 'object' ? req.body.id : null));
      if (!(await loadManagedModule(res, user, id))) return;

      // Soft delete: student work stays and the module can be restored.
      const deleted = await sql`UPDATE np_modules SET deleted_at=NOW(), updated_at=NOW() WHERE id=${id} AND deleted_at IS NULL RETURNING id, title`;
      if (!deleted.length) return res.status(404).json({ error: 'Modul topilmadi.' });
      await audit(user, 'module.delete', `Modul: ${deleted[0].title}`, { module_id: id });
      return res.json({ ok: true, id });
    }

    return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Bu tartib raqamli modul allaqachon bor.' });
    if (error.code === '23503') return res.status(400).json({ error: 'Muqova rasmi topilmadi.' });
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
