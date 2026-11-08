const sql = require('./_db');
const { requireUser } = require('./_auth');
const { findAttachable, isUuid } = require('./_files');

const STEP_TYPES = ['diag', 'video', 'pres', 'doc', 'task', 'refl'];
const REVIEWABLE_STEPS = ['task', 'refl'];
const STEPS_REQUIRING_MATERIAL = ['diag', 'video', 'pres', 'doc'];
const STAFF = ['teacher', 'admin'];
const STEP_SCORE = 15;

function normalizeAnswer(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/[`’‘ʻʼ´]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('uz');
}

function parseOptionalId(value) {
  if (value === undefined || value === '') return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 1 ? id : NaN;
}

async function readProgress(req, res, user) {
  const moduleId = parseOptionalId(req.query.module_id);
  const studentId = parseOptionalId(req.query.user_id);
  if (Number.isNaN(moduleId)) return res.status(400).json({ error: 'Modul raqami noto‘g‘ri.' });
  if (Number.isNaN(studentId)) return res.status(400).json({ error: 'Talaba raqami noto‘g‘ri.' });

  if (user.role === 'student') {
    if (studentId !== null && studentId !== user.id) return res.status(403).json({ error: 'Bu amal uchun ruxsat yo‘q.' });
    return res.json(await sql`
      SELECT * FROM np_progress
      WHERE user_id=${user.id} AND (${moduleId}::int IS NULL OR module_id=${moduleId}::int)
        AND module_id IN (SELECT id FROM np_modules WHERE deleted_at IS NULL)`);
  }

  return res.json(await sql`
    SELECT p.*, u.name AS student_name, u.login AS student_login, m.title AS module_title, m.order_num AS module_order
    FROM np_progress p
    JOIN np_users u ON u.id = p.user_id
    JOIN np_modules m ON m.id = p.module_id
    WHERE u.deleted_at IS NULL AND m.deleted_at IS NULL
      AND (${moduleId}::int IS NULL OR p.module_id=${moduleId}::int)
      AND (${studentId}::int IS NULL OR p.user_id=${studentId}::int)
    ORDER BY p.updated_at DESC`);
}

async function saveReview(res, teacher, body) {
  const progressId = Number(body.progress_id);
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : '';
  const step = body.step;
  if (!Number.isSafeInteger(progressId) || progressId < 1) return res.status(400).json({ error: 'Topshiriq raqami noto‘g‘ri.' });
  if (!REVIEWABLE_STEPS.includes(step)) return res.status(400).json({ error: 'Qadam turi noto‘g‘ri.' });
  if (!feedback || feedback.length > 5000) return res.status(400).json({ error: 'Fikr 1–5000 belgidan iborat bo‘lsin.' });

  // jsonb_set only creates the last path element, so "reviews" must exist first.
  const rows = await sql`
    UPDATE np_progress
    SET step_responses = jsonb_set(
          jsonb_set(step_responses, '{reviews}', COALESCE(step_responses->'reviews', '{}'::jsonb), true),
          ARRAY['reviews', ${step}::text],
          jsonb_build_object('feedback', ${feedback}::text, 'teacher_name', ${teacher.name || teacher.login}::text, 'reviewed_at', NOW()::text),
          true
        ),
        updated_at = NOW()
    WHERE id=${progressId}
    RETURNING *`;
  if (!rows.length) return res.status(404).json({ error: 'Topshiriq topilmadi.' });
  return res.json(rows[0]);
}

async function hasMaterial(moduleId, stepType) {
  const rows = await sql`
    SELECT content FROM np_module_content
    WHERE module_id=${moduleId} AND step_type=${stepType} LIMIT 1`;
  const content = rows[0]?.content;
  return Boolean(content && (content.value || content.file?.id));
}

async function completeStep(res, user, body) {
  const moduleId = Number(body.module_id);
  const stepType = body.step_type;
  const response = typeof body.response === 'string' ? body.response.trim() : '';
  const stepIndex = STEP_TYPES.indexOf(stepType);
  if (!Number.isSafeInteger(moduleId) || moduleId < 1) return res.status(400).json({ error: 'Modul raqami noto‘g‘ri.' });
  if (stepIndex < 0) return res.status(400).json({ error: 'Qadam turi noto‘g‘ri.' });
  if (response.length > 10000) return res.status(400).json({ error: 'Javob 10 000 belgidan oshmasin.' });

  const active = await sql`SELECT 1 FROM np_modules WHERE id=${moduleId} AND deleted_at IS NULL LIMIT 1`;
  if (!active.length) return res.status(404).json({ error: 'Modul topilmadi.' });

  const current = await sql`
    SELECT completed_steps, total_score, step_responses
    FROM np_progress WHERE user_id=${user.id} AND module_id=${moduleId}`;
  const progress = current[0] || { completed_steps: [], total_score: 0, step_responses: {} };
  const completedSteps = Array.isArray(progress.completed_steps) ? progress.completed_steps : [];
  if (completedSteps.includes(stepType)) return res.json(progress);
  if (stepIndex > 0 && !completedSteps.includes(STEP_TYPES[stepIndex - 1])) {
    return res.status(409).json({ error: 'Avval oldingi qadamni bajaring.' });
  }

  if (STEPS_REQUIRING_MATERIAL.includes(stepType) && !(await hasMaterial(moduleId, stepType))) {
    return res.status(409).json({ error: 'O‘qituvchi bu qadam uchun material qo‘shmagan.' });
  }

  const responses = { ...(progress.step_responses || {}) };
  let attachment = null;
  if (stepType === 'task' && body.file_id !== undefined && body.file_id !== null) {
    attachment = isUuid(body.file_id)
      ? await findAttachable(body.file_id, { purpose: 'submission', moduleId, stepType: 'task', ownerId: user.id })
      : null;
    if (!attachment) return res.status(400).json({ error: 'Biriktirilgan fayl topilmadi.' });
    responses.task_file = attachment;
  }

  if (stepType === 'diag' && !response) return res.status(400).json({ error: 'Javobni kiriting.' });
  if (stepType === 'refl' && !response) return res.status(400).json({ error: 'Javob matnini kiriting.' });
  if (stepType === 'task' && !response && !attachment) return res.status(400).json({ error: 'Javob matnini yozing yoki fayl biriktiring.' });

  let earned = 0;
  if (stepType === 'task') earned = STEP_SCORE;
  if (stepType === 'diag') {
    const rows = await sql`
      SELECT content->>'answer' AS answer FROM np_module_content
      WHERE module_id=${moduleId} AND step_type='diag' LIMIT 1`;
    const isCorrect = Boolean(rows[0]?.answer) && normalizeAnswer(response) === normalizeAnswer(rows[0].answer);
    responses.diag_correct = isCorrect;
    if (isCorrect) earned = STEP_SCORE;
  }
  if (response) responses[stepType] = response;

  const steps = JSON.stringify([...completedSteps, stepType]);
  const score = Number(progress.total_score || 0) + earned;
  const serializedResponses = JSON.stringify(responses);

  // The WHERE clause stops a double submit from awarding the score twice.
  const rows = await sql`
    INSERT INTO np_progress(user_id, module_id, completed_steps, total_score, step_responses)
    VALUES(${user.id}, ${moduleId}, ${steps}, ${score}, ${serializedResponses})
    ON CONFLICT(user_id, module_id) DO UPDATE
      SET completed_steps=${steps}, total_score=${score}, step_responses=${serializedResponses}, updated_at=NOW()
      WHERE NOT (np_progress.completed_steps ? ${stepType}::text)
    RETURNING *`;
  if (rows.length) return res.json(rows[0]);

  const latest = await sql`SELECT * FROM np_progress WHERE user_id=${user.id} AND module_id=${moduleId}`;
  return res.json(latest[0]);
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const user = await requireUser(req, res, ['student', ...STAFF]);
    if (!user) return;

    if (req.method === 'GET') return await readProgress(req, res, user);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.action === 'review') {
      if (!STAFF.includes(user.role)) return res.status(403).json({ error: 'Bu amal uchun ruxsat yo‘q.' });
      return await saveReview(res, user, body);
    }
    if (user.role !== 'student') return res.status(403).json({ error: 'Bu amal uchun ruxsat yo‘q.' });
    return await completeStep(res, user, body);
  } catch (error) {
    if (error.code === '23503') return res.status(404).json({ error: 'Modul topilmadi.' });
    console.error(error);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
