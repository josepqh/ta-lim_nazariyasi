const sql = require('../_db');
const { requireUser } = require('../_auth');
const { reportServerError } = require('../_errors');
const { isUuid } = require('../_files');

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
};

// Covers for modules and articles. The browser shrinks a photo before sending it, so one fits in a request.
// An image never changes after upload (a new cover gets a new id), so it can be cached for good.
module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const { id } = req.query;
      if (!isUuid(id)) return res.status(400).json({ error: 'Rasm raqami noto‘g‘ri.' });
      const rows = await sql`SELECT mime, data FROM np_images WHERE id=${id}::uuid LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'Rasm topilmadi.' });
      res.setHeader('Content-Type', rows[0].mime);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      return res.status(200).send(Buffer.from(rows[0].data));
    }
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });
    const user = await requireUser(req, res, ['teacher', 'admin']);
    if (!user) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const check = SIGNATURES[body.mime];
    if (!check || typeof body.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) {
      return res.status(415).json({ error: 'Faqat JPG, PNG yoki WebP rasm yuklang.' });
    }
    const bytes = Buffer.from(body.data, 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'Rasm hajmi 1.5 MB dan oshmasin.' });
    if (!check(bytes)) return res.status(415).json({ error: 'Fayl mazmuni rasm formatiga mos emas.' });
    const [row] = await sql`
      INSERT INTO np_images(owner_id, mime, data) VALUES(${user.id}, ${body.mime}, decode(${body.data}, 'base64')) RETURNING id`;
    return res.status(201).json({ id: row.id });
  } catch (error) {
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
