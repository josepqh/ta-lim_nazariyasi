const sql = require('./_db');
const { requireUser } = require('./_auth');
const { isUuid } = require('./_files');
const llm = require('./_llm');
const { consumeLimit } = require('./_rateLimit');
const { extractDocumentText, normalizeQuestions, parseTests, studentPaper, toAiText } = require('./_quiz');

const STAFF = ['teacher', 'admin'];
const MIN_TEXT_LENGTH = 30;
const MAX_AI_QUESTIONS = 30;
const MAX_AI_REQUESTS_PER_HOUR = 20;

async function loadSourceText(fileId, userId) {
  const rows = await sql`
    SELECT id, extension FROM np_files
    WHERE id=${fileId}::uuid AND owner_id=${userId} AND purpose='quiz_source' AND status='ready' LIMIT 1`;
  if (!rows.length) return null;
  const chunks = await sql`
    SELECT replace(encode(data, 'base64'), E'\n', '') AS data
    FROM np_file_chunks WHERE file_id=${fileId}::uuid ORDER BY chunk_index`;
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data, 'base64')));
  try {
    return await extractDocumentText(buffer, rows[0].extension);
  } catch (error) {
    console.error('Quiz source could not be read:', error.message);
    return '';
  }
}

async function askAi(res, user, kind, text, count) {
  if (!(await consumeLimit(`quiz-ai:user:${user.id}`, MAX_AI_REQUESTS_PER_HOUR, 3600))) {
    res.status(429).json({ error: 'Bir soatlik AI so‘rovlari chegarasiga yetdingiz. Keyinroq urinib ko‘ring.' });
    return null;
  }
  const plan = llm.planRequest(kind, count);
  const truncated = text.length > plan.maxChars;
  const source = toAiText(text.slice(0, plan.maxChars));
  const items = kind === 'generate'
    ? (await llm.generateQuestions(source, count, plan.maxCompletion)).slice(0, count)
    : await llm.extractQuestions(source, plan.maxCompletion);
  if (!items.length) return { questions: [], truncated };
  const questions = normalizeQuestions(
    items.map((item) => ({
      text: item.text,
      options: item.options,
      correct: Number.isInteger(item.correct_index) && item.correct_index >= 0 ? item.correct_index : null
    })),
    { allowMissing: true }
  );
  if (!questions) {
    res.status(502).json({ error: 'AI yaroqli test qaytarmadi. Qayta urinib ko‘ring.' });
    return null;
  }
  return { questions, truncated };
}

async function extract(res, user, body) {
  const { mode, file_id: fileId } = body;
  if (!['parsed', 'generate'].includes(mode)) return res.status(400).json({ error: 'Rejim noto‘g‘ri.' });
  if (!isUuid(fileId)) return res.status(400).json({ error: 'Fayl raqami noto‘g‘ri.' });
  const count = Number(body.count);
  if (mode === 'generate' && (!Number.isInteger(count) || count < 1 || count > MAX_AI_QUESTIONS)) {
    return res.status(400).json({ error: `Testlar soni 1 dan ${MAX_AI_QUESTIONS} gacha bo‘lsin.` });
  }

  const text = await loadSourceText(fileId, user.id);
  if (text === null) return res.status(404).json({ error: 'Fayl topilmadi.' });
  if (text.length < MIN_TEXT_LENGTH) {
    return res.status(422).json({ error: 'Fayldan matn o‘qib bo‘lmadi. Skanerlangan bo‘lsa, matnli PDF yoki DOCX yuklang.' });
  }

  if (mode === 'parsed') {
    const found = parseTests(text);
    const parsed = found.length ? normalizeQuestions(found.slice(0, 200), { allowMissing: true }) : null;
    if (parsed) return res.json({ questions: parsed, source: 'file', truncated: false });
  }

  const result = await askAi(res, user, mode === 'generate' ? 'generate' : 'extract', text, count);
  if (!result) return;
  if (!result.questions.length) {
    return res.status(422).json({ error: 'Faylda test topilmadi. "AI test tuzsin" rejimini tanlang.' });
  }
  return res.json({ ...result, source: 'ai' });
}

async function readPaper(req, res, user) {
  const moduleId = Number(req.query.module_id);
  if (!Number.isSafeInteger(moduleId) || moduleId < 1) return res.status(400).json({ error: 'Modul raqami noto‘g‘ri.' });
  const rows = await sql`
    SELECT c.content FROM np_module_content c
    JOIN np_modules m ON m.id = c.module_id
    WHERE c.module_id=${moduleId} AND c.step_type='diag' AND m.deleted_at IS NULL LIMIT 1`;
  const questions = rows[0]?.content?.questions;
  if (!Array.isArray(questions) || !questions.length) return res.status(404).json({ error: 'Test topilmadi.' });
  return res.json(studentPaper(questions, user.id, moduleId));
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      const user = await requireUser(req, res);
      if (!user) return;
      return await readPaper(req, res, user);
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });

    const staff = await requireUser(req, res, STAFF);
    if (!staff) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.action === 'extract') return await extract(res, staff, body);
    return res.status(400).json({ error: 'Noto‘g‘ri so‘rov.' });
  } catch (error) {
    if (error instanceof llm.AssistantError) return res.status(error.status).json({ error: error.message });
    console.error(error);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
