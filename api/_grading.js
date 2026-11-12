// The final result of a module, counted from all six steps.
// The test is graded by its answers, the three materials by being worked through, and the
// practical task and the reflection by the teacher's score (0–100) given when reviewing.
const WEIGHTS = { diag: 30, video: 10, pres: 10, doc: 10, task: 25, refl: 15 };
const STEPS = Object.keys(WEIGHTS);
const TEACHER_SCORED = ['task', 'refl'];
const PASS_PERCENT = 55;

// The five-point scale used in Uzbek higher education.
function gradeFor(percent) {
  if (percent >= 86) return { grade: 5, label: 'a’lo' };
  if (percent >= 71) return { grade: 4, label: 'yaxshi' };
  if (percent >= PASS_PERCENT) return { grade: 3, label: 'qoniqarli' };
  return { grade: 2, label: 'qoniqarsiz' };
}

const validScore = (value) => Number.isInteger(value) && value >= 0 && value <= 100;

function testPercent(responses) {
  const result = responses.diag_result;
  if (result && Number(result.total) > 0) return Math.round((100 * Number(result.correct)) / Number(result.total));
  return responses.diag_correct ? 100 : 0;
}

// { parts, waiting, percent, grade, label, passed } for a progress row. percent is null until
// every step is done and the teacher has scored both written steps; waiting names what is missing.
function moduleResult(progress) {
  const done = new Set(Array.isArray(progress?.completed_steps) ? progress.completed_steps : []);
  const responses = progress?.step_responses || {};
  const parts = {};
  for (const step of STEPS) {
    if (!done.has(step)) parts[step] = null;
    else if (step === 'diag') parts[step] = testPercent(responses);
    else if (TEACHER_SCORED.includes(step)) {
      const score = responses.reviews?.[step]?.score;
      parts[step] = validScore(score) ? score : null;
    } else parts[step] = 100;
  }
  const complete = STEPS.every((step) => done.has(step));
  const waiting = complete ? TEACHER_SCORED.filter((step) => parts[step] === null) : [];
  if (!complete || waiting.length) return { parts, waiting, percent: null, grade: null, label: null, passed: false };
  const percent = Math.round(STEPS.reduce((sum, step) => sum + WEIGHTS[step] * parts[step], 0) / 100);
  return { parts, waiting, percent, ...gradeFor(percent), passed: percent >= PASS_PERCENT };
}

module.exports = { PASS_PERCENT, TEACHER_SCORED, WEIGHTS, gradeFor, moduleResult, validScore };
