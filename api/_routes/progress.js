const sql = require('../_db');
const { reportServerError } = require('../_errors');
const { requireUser } = require('../_auth');
const { findAttachable, isUuid } = require('../_files');
const { gradeAnswers, quizVersion } = require('../_quiz');
const { canManage } = require('../_modules');
const { audit } = require('../_audit');
const { syncCertificate } = require('../_certificates');
const { moduleResult, validScore } = require('../_grading');

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

// The per-question breakdown holds answers other students could still be asked,
// so a student sees it only where the teacher chose to show answers after the test.
function forStudent(row, showAnswers = false) {
  if (!row) return row;
  const withResult = { ...row, result: moduleResult(row) };
  if (!row.step_responses?.diag_detail || showAnswers) return withResult;
  const { diag_detail: _hidden, ...stepResponses } = row.step_responses;
  return { ...withResult, step_responses: stepResponses };
}

async function quizSettings(moduleId) {
  const rows = await sql`
    SELECT content FROM np_module_content WHERE module_id=${moduleId} AND step_type='diag' LIMIT 1`;
  const content = rows[0]?.content || {};
  return { allowRetake: content.allow_retake === true, showAnswers: content.show_answers === true, questions: Array.isArray(content.questions) && content.questions.length ? content.questions : null };
}

async function modulesShowingAnswers() {
  const rows = await sql`
    SELECT module_id FROM np_module_content WHERE step_type='diag' AND content->>'show_answers' = 'true'`;
  return new Set(rows.map((row) => Number(row.module_id)));
}

function parseOptionalId(value) {
  if (value === undefined || value === '') return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 1 ? id : NaN;
}

async function readProgress(req, res, user) {
  const moduleId = parseOptionalId(req.query.module_id);
  const studentId = parseOptionalId(req.query.user_id);
  const groupId = parseOptionalId(req.query.group_id);
  if (Number.isNaN(groupId)) return res.status(400).json({ error: 'Guruh raqami noto‘g‘ri.' });
  if (Number.isNaN(moduleId)) return res.status(400).json({ error: 'Modul raqami noto‘g‘ri.' });
  if (Number.isNaN(studentId)) return res.status(400).json({ error: 'Talaba raqami noto‘g‘ri.' });

  if (user.role === 'student') {
    if (studentId !== null && studentId !== user.id) return res.status(403).json({ error: 'Bu amal uchun ruxsat yo‘q.' });
    const rows = await sql`
      SELECT * FROM np_progress
      WHERE user_id=${user.id} AND (${moduleId}::int IS NULL OR module_id=${moduleId}::int)
        AND module_id IN (SELECT id FROM np_modules WHERE deleted_at IS NULL)`;
    const showing = await modulesShowingAnswers();
    return res.json(rows.map((row) => forStudent(row, showing.has(Number(row.module_id)))));
  }

  const rows = await sql`
    SELECT p.*, u.name AS student_name, u.login AS student_login, m.title AS module_title, m.order_num AS module_order
    FROM np_progress p
    JOIN np_users u ON u.id = p.user_id
    JOIN np_modules m ON m.id = p.module_id
    WHERE u.deleted_at IS NULL AND m.deleted_at IS NULL
      AND (${moduleId}::int IS NULL OR p.module_id=${moduleId}::int)
      AND (${studentId}::int IS NULL OR p.user_id=${studentId}::int)
      AND (${groupId}::int IS NULL OR p.user_id IN (SELECT user_id FROM np_group_members WHERE group_id=${groupId}::int))
    ORDER BY p.updated_at DESC`;
  return res.json(rows.map((row) => ({ ...row, result: moduleResult(row) })));
}

async function saveReview(res, teacher, body) {
  const progressId = Number(body.progress_id);
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : '';
  const step = body.step;
  // The score (0–100) counts towards the module's grade; without one, an earlier score is kept.
  const score = body.score === undefined || body.score === null || body.score === '' ? null : Number(body.score);
  if (!Number.isSafeInteger(progressId) || progressId < 1) return res.status(400).json({ error: 'Topshiriq raqami noto‘g‘ri.' });
  if (!REVIEWABLE_STEPS.includes(step)) return res.status(400).json({ error: 'Qadam turi noto‘g‘ri.' });
  if (score !== null && !validScore(score)) return res.status(400).json({ error: 'Ball 0 dan 100 gacha butun son bo‘lsin.' });
  if (feedback.length > 5000) return res.status(400).json({ error: 'Fikr 5000 belgidan oshmasin.' });
  if (!feedback && score === null) return res.status(400).json({ error: 'Ball qo‘ying yoki fikr yozing.' });

  const owners = await sql`
    SELECT m.created_by, p.user_id, p.module_id, p.completed_steps FROM np_progress p JOIN np_modules m ON m.id = p.module_id
    WHERE p.id=${progressId} LIMIT 1`;
  if (!owners.length) return res.status(404).json({ error: 'Topshiriq topilmadi.' });
  if (!canManage(teacher, owners[0])) return res.status(403).json({ error: 'Bu modul ishlarini faqat uning muallifi yoki administrator baholaydi.' });
  if (!owners[0].completed_steps.includes(step)) return res.status(409).json({ error: 'Talaba bu qadamni hali topshirmagan.' });

  // jsonb_set only creates the last path element, so "reviews" must exist first.
  const rows = await sql`
    UPDATE np_progress
    SET step_responses = jsonb_set(
          jsonb_set(step_responses, '{reviews}', COALESCE(step_responses->'reviews', '{}'::jsonb), true),
          ARRAY['reviews', ${step}::text],
          jsonb_build_object(
            'feedback', ${feedback}::text,
            'score', COALESCE(${score}::int, (step_responses->'reviews'->${step}::text->>'score')::int),
            'teacher_name', ${teacher.name || teacher.login}::text,
            'reviewed_at', NOW()::text
          ),
          true
        ),
        updated_at = NOW()
    WHERE id=${progressId}
    RETURNING *`;
  if (!rows.length) return res.status(404).json({ error: 'Topshiriq topilmadi.' });
  await audit(teacher, 'work.review', `Talaba ishi #${progressId}: ${step}`, { progress_id: progressId, step, score });
  // Scoring the last written step is what issues the certificate.
  const { certificate } = await syncCertificate(owners[0].user_id, owners[0].module_id);
  return res.json({ ...rows[0], result: moduleResult(rows[0]), ...(certificate ? { certificate } : {}) });
}

// A new attempt at the test, when the teacher allows it. The best result counts; the order of
// questions and answers is new each time.
async function retakeQuiz(res, user, body, progress) {
  const moduleId = Number(body.module_id);
  const settings = await quizSettings(moduleId);
  if (!settings.allowRetake || !settings.questions) return res.status(403).json({ error: 'Bu testni qayta topshirib bo‘lmaydi.' });
  if (body.version !== quizVersion(settings.questions)) return res.status(409).json({ error: 'Test yangilandi. Sahifani yangilab, qayta yeching.' });
  const attempt = Number(progress.step_responses?.diag_attempts) || 1;
  const result = gradeAnswers(settings.questions, user.id, moduleId, body.answers, attempt);
  if (!result) return res.status(400).json({ error: 'Barcha savollarga javob bering.' });

  const earned = Math.round((STEP_SCORE * result.correct) / result.total);
  const previous = progress.step_responses?.diag_result;
  const previousScore = Number(previous?.score) || 0;
  const better = earned >= previousScore;
  const responses = { ...progress.step_responses, diag_attempts: attempt + 1, diag_last: { correct: result.correct, total: result.total, score: earned } };
  if (better) {
    responses.diag = `${result.correct}/${result.total}`;
    responses.diag_correct = result.correct === result.total;
    responses.diag_result = { correct: result.correct, total: result.total, score: earned };
    responses.diag_detail = result.detail;
  }
  const score = Number(progress.total_score || 0) - previousScore + Math.max(earned, previousScore);
  // The attempt number in WHERE stops a double submit from counting one attempt twice.
  const rows = await sql`
    UPDATE np_progress SET step_responses=${JSON.stringify(responses)}, total_score=${score}, updated_at=NOW()
    WHERE user_id=${user.id} AND module_id=${moduleId}
      AND COALESCE((step_responses->>'diag_attempts')::int, 1) = ${attempt}
    RETURNING *`;
  const saved = rows[0] || (await sql`SELECT * FROM np_progress WHERE user_id=${user.id} AND module_id=${moduleId}`)[0];
  // A better test result raises the grade on a certificate already given, or earns one.
  const { certificate } = await syncCertificate(user.id, moduleId);
  return res.json({ ...forStudent(saved, settings.showAnswers), ...(certificate ? { certificate } : {}) });
}

async function hasMaterial(moduleId, stepType) {
  const rows = await sql`
    SELECT content FROM np_module_content
    WHERE module_id=${moduleId} AND step_type=${stepType} LIMIT 1`;
  const content = rows[0]?.content;
  return Boolean(content && (content.value || content.file?.id || content.questions?.length));
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
  if (stepType === 'diag' && body.retake === true) {
    if (!completedSteps.includes('diag')) return res.status(409).json({ error: 'Avval testni bir marta topshiring.' });
    return await retakeQuiz(res, user, body, progress);
  }
  const { showAnswers } = stepType === 'diag' ? await quizSettings(moduleId) : { showAnswers: false };
  if (completedSteps.includes(stepType)) return res.json(forStudent(progress, showAnswers));
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

  const quizRows = stepType === 'diag'
    ? await sql`SELECT content->'questions' AS questions FROM np_module_content WHERE module_id=${moduleId} AND step_type='diag' LIMIT 1`
    : [];
  const quiz = Array.isArray(quizRows[0]?.questions) && quizRows[0].questions.length ? quizRows[0].questions : null;

  if (stepType === 'diag' && !quiz && !response) return res.status(400).json({ error: 'Javobni kiriting.' });
  if (stepType === 'refl' && !response) return res.status(400).json({ error: 'Javob matnini kiriting.' });
  if (stepType === 'task' && !response && !attachment) return res.status(400).json({ error: 'Javob matnini yozing yoki fayl biriktiring.' });

  let earned = 0;
  if (stepType === 'task') earned = STEP_SCORE;
  if (quiz) {
    if (body.version !== quizVersion(quiz)) return res.status(409).json({ error: 'Test yangilandi. Sahifani yangilab, qayta yeching.' });
    const result = gradeAnswers(quiz, user.id, moduleId, body.answers);
    if (!result) return res.status(400).json({ error: 'Barcha savollarga javob bering.' });
    earned = Math.round((STEP_SCORE * result.correct) / result.total);
    responses.diag = `${result.correct}/${result.total}`;
    responses.diag_correct = result.correct === result.total;
    responses.diag_result = { correct: result.correct, total: result.total, score: earned };
    responses.diag_detail = result.detail;
  } else if (stepType === 'diag') {
    const rows = await sql`
      SELECT content->>'answer' AS answer FROM np_module_content
      WHERE module_id=${moduleId} AND step_type='diag' LIMIT 1`;
    const isCorrect = Boolean(rows[0]?.answer) && normalizeAnswer(response) === normalizeAnswer(rows[0].answer);
    responses.diag_correct = isCorrect;
    if (isCorrect) earned = STEP_SCORE;
  }
  if (response && !quiz) responses[stepType] = response;

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
  const saved = rows.length ? rows[0] : (await sql`SELECT * FROM np_progress WHERE user_id=${user.id} AND module_id=${moduleId}`)[0];
  // The sixth step can earn the certificate (once the teacher's scores are in and the result passes).
  const { certificate } = saved && saved.completed_steps.length >= STEP_TYPES.length ? await syncCertificate(user.id, moduleId) : { certificate: null };
  const showing = await modulesShowingAnswers();
  return res.json({ ...forStudent(saved, showing.has(moduleId)), ...(certificate ? { certificate } : {}) });
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
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
