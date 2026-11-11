const sql = require('../_db');
const { reportServerError } = require('../_errors');
const { getSessionUser, requireUser } = require('../_auth');
const { deleteOtherContentFiles, findAttachable } = require('../_files');
const { normalizeQuestions } = require('../_quiz');
const { loadManagedModule } = require('../_modules');
const { audit } = require('../_audit');

const STEP_TYPES = new Set(['diag', 'video', 'pres', 'doc', 'task', 'refl']);
const FILE_REQUIRED_STEPS = new Set(['pres', 'doc']);
const FILE_ALLOWED_STEPS = new Set(['pres', 'doc', 'task']);

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    let videoId = '';
    if (host === 'youtu.be') videoId = url.pathname.slice(1).split('/')[0];
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
      if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
      else videoId = url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] || '';
    }
    return /^[\w-]{11}$/.test(videoId);
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const moduleId = Number(req.query.module_id);
      if (!Number.isSafeInteger(moduleId) || moduleId < 1) return res.status(400).json({ error: 'Modul raqami noto‘g‘ri.' });

      const rows = await sql`
        SELECT c.* FROM np_module_content c
        JOIN np_modules m ON m.id = c.module_id
        WHERE c.module_id=${moduleId} AND m.deleted_at IS NULL`;
      const user = await getSessionUser(req);
      if (user && ['teacher', 'admin'].includes(user.role)) return res.json(rows);

      const publicRows = rows.map((row) => {
        if (row.step_type !== 'diag' || !row.content || typeof row.content !== 'object') return row;
        const publicContent = { ...row.content };
        delete publicContent.answer;
        if (Array.isArray(publicContent.questions)) {
          publicContent.questions_count = publicContent.questions.length;
          delete publicContent.questions;
        }
        return { ...row, content: publicContent };
      });
      return res.json(publicRows);
    }

    if (req.method === 'POST') {
      const user = await requireUser(req, res, ['teacher', 'admin']);
      if (!user) return;

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const moduleId = Number(body.module_id);
      const stepType = body.step_type;
      const value = typeof body.content?.value === 'string' ? body.content.value.trim() : '';
      const answer = typeof body.content?.answer === 'string' ? body.content.answer.trim() : '';
      if (!Number.isSafeInteger(moduleId) || moduleId < 1) return res.status(400).json({ error: 'Modul raqami noto‘g‘ri.' });
      if (!STEP_TYPES.has(stepType)) return res.status(400).json({ error: 'Qadam turi noto‘g‘ri.' });
      if (value.length > 30000) return res.status(400).json({ error: 'Material 30 000 belgidan oshmasin.' });
      const hasQuestions = stepType === 'diag' && body.content?.questions !== undefined;
      const questions = hasQuestions ? normalizeQuestions(body.content.questions) : null;
      if (hasQuestions && !questions) return res.status(400).json({ error: 'Test savollari to‘liq emas: har savolda to‘g‘ri javob belgilansin.' });
      if (!FILE_REQUIRED_STEPS.has(stepType) && !value && !questions) return res.status(400).json({ error: 'Material matnini kiriting.' });
      if (stepType === 'diag' && !questions && (!answer || answer.length > 500)) return res.status(400).json({ error: 'Test javobini kiriting (500 belgigancha).' });
      if (stepType === 'video' && !isYouTubeUrl(value)) return res.status(400).json({ error: 'HTTPS YouTube havolasini kiriting.' });

      if (!(await loadManagedModule(res, user, moduleId))) return;

      const fileId = body.content?.file_id ?? null;
      let file = null;
      if (fileId !== null) {
        if (!FILE_ALLOWED_STEPS.has(stepType)) return res.status(400).json({ error: 'Bu qadamga fayl biriktirilmaydi.' });
        file = await findAttachable(fileId, { purpose: 'content', moduleId, stepType });
        if (!file) return res.status(400).json({ error: 'Biriktirilgan fayl topilmadi.' });
      }
      if (FILE_REQUIRED_STEPS.has(stepType) && !file) return res.status(400).json({ error: 'Faylni yuklang.' });

      const content = { value };
      if (questions) content.questions = questions;
      else if (stepType === 'diag') content.answer = answer;
      if (stepType === 'diag') {
        // The teacher decides whether a test may be taken again and whether students see the answers afterwards.
        content.allow_retake = body.content?.allow_retake === true;
        content.show_answers = body.content?.show_answers === true;
      }
      if (file) content.file = file;
      const serialized = JSON.stringify(content);

      const rows = await sql`
        INSERT INTO np_module_content(module_id, step_type, content, updated_by)
        VALUES(${moduleId}, ${stepType}, ${serialized}, ${user.id})
        ON CONFLICT(module_id, step_type) DO UPDATE
          SET content=${serialized}, updated_by=${user.id}, updated_at=NOW()
        RETURNING *`;
      if (FILE_ALLOWED_STEPS.has(stepType)) await deleteOtherContentFiles(moduleId, stepType, file ? file.id : null);
      await audit(user, 'content.save', `Modul #${moduleId}: ${stepType}`, { module_id: moduleId, step: stepType });
      return res.json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const user = await requireUser(req, res, ['teacher', 'admin']);
      if (!user) return;

      const moduleId = Number(req.query.module_id || req.body?.module_id);
      const stepType = req.query.step_type || req.body?.step_type;
      if (!Number.isSafeInteger(moduleId) || moduleId < 1) return res.status(400).json({ error: 'Modul raqami noto‘g‘ri.' });
      if (!STEP_TYPES.has(stepType)) return res.status(400).json({ error: 'Qadam turi noto‘g‘ri.' });
      if (!(await loadManagedModule(res, user, moduleId))) return;

      await sql`DELETE FROM np_module_content WHERE module_id=${moduleId} AND step_type=${stepType}`;
      await audit(user, 'content.delete', `Modul #${moduleId}: ${stepType}`, { module_id: moduleId, step: stepType });
      if (FILE_ALLOWED_STEPS.has(stepType)) await deleteOtherContentFiles(moduleId, stepType, null);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });
  } catch (error) {
    if (error.code === '23503') return res.status(404).json({ error: 'Modul topilmadi.' });
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
