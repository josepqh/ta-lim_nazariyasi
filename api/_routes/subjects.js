const sql = require('../_db');
const { reportServerError } = require('../_errors');
const { requireUser } = require('../_auth');
const { audit } = require('../_audit');
const { isUuid } = require('../_files');

// Any teacher may open a new subject; its author and the administrator may change or remove it.
function canManageSubject(user, subject) {
  return user.role === 'admin' || (user.role === 'teacher' && Number(subject.created_by) === Number(user.id));
}

async function loadSubject(res, user, id) {
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: 'Fan raqami noto‘g‘ri.' });
    return null;
  }
  const [subject] = await sql`SELECT * FROM np_subjects WHERE id=${id} AND deleted_at IS NULL`;
  if (!subject) {
    res.status(404).json({ error: 'Fan topilmadi.' });
    return null;
  }
  if (!canManageSubject(user, subject)) {
    res.status(403).json({ error: 'Bu fanni faqat uning muallifi yoki administrator o‘zgartira oladi.' });
    return null;
  }
  return subject;
}

function readFields(body) {
  const title = typeof body.title === 'string' ? body.title.trim().replace(/\s+/g, ' ') : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const orderNum = body.order_num === undefined || body.order_num === null || body.order_num === '' ? null : Number(body.order_num);
  if (title.length < 2 || title.length > 200) return { error: 'Fan nomi 2–200 belgidan iborat bo‘lsin.' };
  if (description.length > 2000) return { error: 'Fan ta’rifi 2000 belgidan oshmasin.' };
  if (orderNum !== null && (!Number.isSafeInteger(orderNum) || orderNum < 1 || orderNum > 100000)) return { error: 'Tartib raqami musbat butun son bo‘lsin.' };
  if (body.cover_image_id !== undefined && body.cover_image_id !== null && !isUuid(body.cover_image_id)) return { error: 'Muqova rasmi noto‘g‘ri.' };
  return { title, description, orderNum };
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      return res.json(await sql`
        SELECT s.id, s.order_num, s.title, s.description, s.cover_image_id, s.created_by,
               COUNT(m.id)::int AS module_count
        FROM np_subjects s
        LEFT JOIN np_modules m ON m.subject_id = s.id AND m.deleted_at IS NULL
        WHERE s.deleted_at IS NULL
        GROUP BY s.id
        ORDER BY s.order_num, s.id`);
    }

    if (req.method === 'POST') {
      const user = await requireUser(req, res, ['teacher', 'admin']);
      if (!user) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const fields = readFields(body);
      if (fields.error) return res.status(400).json({ error: fields.error });
      const cover = body.cover_image_id ?? null;

      if (body.id !== undefined && body.id !== null && body.id !== '') {
        const subject = await loadSubject(res, user, Number(body.id));
        if (!subject) return;
        // The cover changes only when the request names one, so renaming never drops a picture.
        const coverChanged = body.cover_image_id !== undefined && cover !== subject.cover_image_id;
        const [row] = await sql`
          UPDATE np_subjects
          SET title=${fields.title}, description=${fields.description},
              order_num=${fields.orderNum ?? subject.order_num},
              cover_image_id=${coverChanged ? cover : subject.cover_image_id}, updated_at=NOW()
          WHERE id=${subject.id} RETURNING *`;
        if (coverChanged && subject.cover_image_id) await sql`DELETE FROM np_images WHERE id=${subject.cover_image_id}::uuid`;
        await audit(user, 'subject.update', `Fan: ${row.title}`, { subject_id: row.id });
        return res.json(row);
      }

      const [{ next }] = await sql`SELECT COALESCE(MAX(order_num), 0) + 1 AS next FROM np_subjects WHERE deleted_at IS NULL`;
      const [row] = await sql`
        INSERT INTO np_subjects(order_num, title, description, cover_image_id, created_by)
        VALUES(${fields.orderNum ?? next}, ${fields.title}, ${fields.description}, ${cover}, ${user.id})
        RETURNING *`;
      await audit(user, 'subject.create', `Fan: ${row.title}`, { subject_id: row.id });
      return res.status(201).json({ ...row, module_count: 0 });
    }

    if (req.method === 'DELETE') {
      const user = await requireUser(req, res, ['teacher', 'admin']);
      if (!user) return;
      const subject = await loadSubject(res, user, Number(req.query.id));
      if (!subject) return;
      const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM np_modules WHERE subject_id=${subject.id} AND deleted_at IS NULL`;
      if (n) return res.status(409).json({ error: `Bu fanda ${n} ta modul bor. Avval modullarni boshqa fanga o‘tkazing yoki o‘chiring.` });
      await sql`UPDATE np_subjects SET deleted_at=NOW(), updated_at=NOW() WHERE id=${subject.id}`;
      await audit(user, 'subject.delete', `Fan: ${subject.title}`, { subject_id: subject.id });
      return res.json({ ok: true, id: subject.id });
    }

    return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Bunday nomli fan allaqachon bor.' });
    if (error.code === '23503') return res.status(400).json({ error: 'Muqova rasmi topilmadi.' });
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
