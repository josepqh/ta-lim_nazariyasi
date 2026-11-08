const sql = require('./_db');
const { requireUser } = require('./_auth');
const {
  ALLOWED_EXTENSIONS, CHUNK_SIZE, MAX_FILE_SIZE,
  cleanFilename, extensionOf, isUuid, matchesSignature, publicFile
} = require('./_files');

const MAX_PENDING_UPLOADS = 5;
const STAFF = ['teacher', 'admin'];

async function startUpload(res, user, body) {
  const moduleId = Number(body.module_id);
  const stepType = body.step_type;
  const purpose = body.purpose;
  const filename = cleanFilename(body.filename);
  const size = Number(body.size);
  const extension = extensionOf(filename);

  if (!['content', 'submission'].includes(purpose)) return res.status(400).json({ error: 'Fayl maqsadi noto‘g‘ri.' });
  if (purpose === 'content' && !STAFF.includes(user.role)) return res.status(403).json({ error: 'Bu amal uchun ruxsat yo‘q.' });
  if (purpose === 'submission' && user.role !== 'student') return res.status(403).json({ error: 'Topshiriqni faqat talaba yuklaydi.' });
  if (purpose === 'submission' && stepType !== 'task') return res.status(400).json({ error: 'Fayl faqat amaliy topshiriqqa biriktiriladi.' });
  if (!Number.isSafeInteger(moduleId) || moduleId < 1) return res.status(400).json({ error: 'Modul raqami noto‘g‘ri.' });

  const allowed = ALLOWED_EXTENSIONS[stepType];
  if (!allowed) return res.status(400).json({ error: 'Bu qadamga fayl biriktirilmaydi.' });
  if (!filename || !allowed.includes(extension)) {
    return res.status(415).json({ error: `Ruxsat etilgan formatlar: ${allowed.join(', ')}.` });
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_SIZE) {
    return res.status(413).json({ error: 'Fayl hajmi 30 MB dan oshmasin.' });
  }

  const modules = await sql`SELECT id FROM np_modules WHERE id=${moduleId} AND deleted_at IS NULL LIMIT 1`;
  if (!modules.length) return res.status(404).json({ error: 'Modul topilmadi.' });

  await sql`DELETE FROM np_files WHERE owner_id=${user.id} AND status='uploading' AND created_at < NOW() - INTERVAL '1 day'`;

  if (purpose === 'submission') {
    const done = await sql`
      SELECT 1 FROM np_progress
      WHERE user_id=${user.id} AND module_id=${moduleId} AND completed_steps ? 'task' LIMIT 1`;
    if (done.length) return res.status(409).json({ error: 'Bu topshiriq allaqachon yuborilgan.' });
    // Until the step is submitted, earlier uploads for it are abandoned attempts.
    await sql`
      DELETE FROM np_files
      WHERE owner_id=${user.id} AND purpose='submission' AND module_id=${moduleId} AND step_type='task'`;
  }

  const pending = await sql`SELECT COUNT(*)::int AS n FROM np_files WHERE owner_id=${user.id} AND status='uploading'`;
  if (pending[0].n >= MAX_PENDING_UPLOADS) {
    return res.status(429).json({ error: 'Tugallanmagan yuklashlar ko‘p. Bir ozdan keyin urinib ko‘ring.' });
  }

  const totalChunks = Math.ceil(size / CHUNK_SIZE);
  const rows = await sql`
    INSERT INTO np_files(owner_id, module_id, step_type, purpose, filename, extension, size_bytes, total_chunks)
    VALUES(${user.id}, ${moduleId}, ${stepType}, ${purpose}, ${filename}, ${extension}, ${size}, ${totalChunks})
    RETURNING id`;
  return res.status(201).json({ id: rows[0].id, chunk_size: CHUNK_SIZE, total_chunks: totalChunks });
}

async function loadOwnUpload(res, user, id) {
  if (!isUuid(id)) {
    res.status(400).json({ error: 'Fayl raqami noto‘g‘ri.' });
    return null;
  }
  const rows = await sql`
    SELECT id, filename, extension, size_bytes, total_chunks, status FROM np_files
    WHERE id=${id}::uuid AND owner_id=${user.id} LIMIT 1`;
  if (!rows.length) {
    res.status(404).json({ error: 'Fayl topilmadi.' });
    return null;
  }
  if (rows[0].status !== 'uploading') {
    res.status(409).json({ error: 'Fayl yuklash allaqachon yakunlangan.' });
    return null;
  }
  return rows[0];
}

async function saveChunk(res, user, body) {
  const file = await loadOwnUpload(res, user, body.id);
  if (!file) return;

  const index = Number(body.index);
  if (!Number.isSafeInteger(index) || index < 0 || index >= file.total_chunks) {
    return res.status(400).json({ error: 'Fayl bo‘lagi raqami noto‘g‘ri.' });
  }
  if (typeof body.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) {
    return res.status(400).json({ error: 'Fayl bo‘lagi noto‘g‘ri.' });
  }

  const bytes = Buffer.from(body.data, 'base64');
  const isLast = index === file.total_chunks - 1;
  const expectedLength = isLast ? Number(file.size_bytes) - CHUNK_SIZE * (file.total_chunks - 1) : CHUNK_SIZE;
  if (bytes.length !== expectedLength) return res.status(400).json({ error: 'Fayl bo‘lagi hajmi noto‘g‘ri.' });

  if (index === 0 && !matchesSignature(file.extension, bytes)) {
    await sql`DELETE FROM np_files WHERE id=${file.id}::uuid`;
    return res.status(415).json({ error: 'Fayl mazmuni uning formatiga mos emas.' });
  }

  // Sent as base64 text because the HTTP driver does not transport binary parameters.
  await sql`
    INSERT INTO np_file_chunks(file_id, chunk_index, data)
    VALUES(${file.id}::uuid, ${index}, decode(${body.data}, 'base64'))
    ON CONFLICT(file_id, chunk_index) DO UPDATE SET data=EXCLUDED.data`;
  return res.json({ ok: true });
}

async function finishUpload(res, user, body) {
  const file = await loadOwnUpload(res, user, body.id);
  if (!file) return;

  const totals = await sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(octet_length(data)), 0)::bigint AS bytes
    FROM np_file_chunks WHERE file_id=${file.id}::uuid`;
  if (totals[0].n !== file.total_chunks || Number(totals[0].bytes) !== Number(file.size_bytes)) {
    return res.status(409).json({ error: 'Fayl to‘liq yuklanmadi. Qayta urinib ko‘ring.' });
  }

  await sql`UPDATE np_files SET status='ready', completed_at=NOW() WHERE id=${file.id}::uuid`;
  return res.json(publicFile(file));
}

async function readFile(req, res, user) {
  const { id } = req.query;
  if (!isUuid(id)) return res.status(400).json({ error: 'Fayl raqami noto‘g‘ri.' });

  const rows = await sql`
    SELECT id, owner_id, purpose, filename, size_bytes, total_chunks FROM np_files
    WHERE id=${id}::uuid AND status='ready' LIMIT 1`;
  const file = rows[0];
  const allowed = file && (file.purpose === 'content' || file.owner_id === user.id || STAFF.includes(user.role));
  // Same answer for "missing" and "forbidden", so file ids cannot be probed.
  if (!allowed) return res.status(404).json({ error: 'Fayl topilmadi.' });

  if (req.query.chunk === undefined) {
    return res.json({ ...publicFile(file), total_chunks: file.total_chunks });
  }

  const index = Number(req.query.chunk);
  if (!Number.isSafeInteger(index) || index < 0 || index >= file.total_chunks) {
    return res.status(400).json({ error: 'Fayl bo‘lagi raqami noto‘g‘ri.' });
  }
  const chunks = await sql`
    SELECT replace(encode(data, 'base64'), E'\n', '') AS data
    FROM np_file_chunks WHERE file_id=${file.id}::uuid AND chunk_index=${index} LIMIT 1`;
  if (!chunks.length) return res.status(404).json({ error: 'Fayl topilmadi.' });
  return res.json({ data: chunks[0].data });
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });

    const user = await requireUser(req, res);
    if (!user) return;
    if (req.method === 'GET') return await readFile(req, res, user);

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.action === 'init') return await startUpload(res, user, body);
    if (body.action === 'chunk') return await saveChunk(res, user, body);
    if (body.action === 'complete') return await finishUpload(res, user, body);
    return res.status(400).json({ error: 'Noto‘g‘ri so‘rov.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
