const { createHash } = require('node:crypto');

const MAX_QUESTIONS = 200;
const MAX_QUESTION_LENGTH = 2000;
const MAX_OPTION_LENGTH = 1000;
const MAX_OPTIONS = 8;
const BOLD_MARK = '\u0001';

const LETTER = '[A-HА-Е]';
const QUESTION_RE = /^(?:savol\s*)?(\d{1,3})\s*(?:[.)]|-\s*savol\s*[.:)]?|-)\s*(\S.*)$/iu;
const OPTION_RE = new RegExp(`^([*+#]?)\\s*(${LETTER})\\s*[).]\\s*(.*?)\\s*([*+]?)$`, 'iu');
const OPTION_SPLIT_RE = new RegExp(`\\s+(?=[*+#]?${LETTER}[).]\\s)`, 'iu');
const KEY_ENTRY_RE = new RegExp(`(\\d{1,3})\\s*[-.):]\\s*(${LETTER})(?![\\p{L}\\p{N}])`, 'giu');
const LETTER_ORDER = 'ABCDEFGH';
const CYRILLIC_LETTER_ORDER = 'АБВГДЕ';

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// One line per paragraph; a line fully in bold is flagged, since many files mark the answer that way.
function htmlToMarkedText(html) {
  return html
    .split(/<\/(?:p|li|h\d)>|<br\s*\/?>/i)
    .map((chunk) => {
      const outsideBold = chunk.replace(/<strong>[\s\S]*?<\/strong>/gi, '').replace(/<[^>]+>/g, '').trim();
      const text = decodeEntities(chunk.replace(/<[^>]+>/g, '')).trim();
      if (!text) return '';
      return !outsideBold && /<strong>/i.test(chunk) ? `${BOLD_MARK}${text}` : text;
    })
    .filter(Boolean)
    .join('\n');
}

async function extractDocumentText(buffer, extension) {
  if (extension === 'docx') {
    const mammoth = require('mammoth');
    const { value } = await mammoth.convertToHtml({ buffer });
    return htmlToMarkedText(value);
  }
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/[ \t]+\n/g, '\n').trim();
}

const toAiText = (text) => text.split(BOLD_MARK).join('[qalin] ');

function letterIndex(letter) {
  const upper = letter.toUpperCase();
  const latin = LETTER_ORDER.indexOf(upper);
  return latin >= 0 ? latin : CYRILLIC_LETTER_ORDER.indexOf(upper);
}

function readAnswerKey(lines) {
  const key = new Map();
  const rest = [];
  for (const line of lines) {
    const entries = [...line.matchAll(KEY_ENTRY_RE)];
    const leftover = line.replace(KEY_ENTRY_RE, '').replace(/[\s,;|]/g, '');
    if (entries.length && !leftover) entries.forEach((entry) => key.set(Number(entry[1]), letterIndex(entry[2])));
    else rest.push(line);
  }
  return { key, rest };
}

// Reads numbered questions with lettered options. Returns [] when the text has no such structure.
function parseTests(text) {
  const { key, rest } = readAnswerKey(text.split('\n').map((line) => line.trim()).filter(Boolean));
  const questions = [];
  let current = null;
  let lastOption = null;

  const addOption = (raw, bold) => {
    const match = raw.match(OPTION_RE);
    if (!match) return;
    lastOption = { text: match[3], marked: Boolean(match[1] || match[4]), bold };
    current.options.push(lastOption);
  };

  for (const rawLine of rest) {
    const bold = rawLine.startsWith(BOLD_MARK);
    const line = bold ? rawLine.slice(1) : rawLine;
    const question = line.match(QUESTION_RE);
    if (question) {
      const parts = question[2].split(OPTION_SPLIT_RE);
      current = { number: Number(question[1]), text: parts[0].trim(), options: [] };
      lastOption = null;
      questions.push(current);
      parts.slice(1).forEach((part) => addOption(part, false));
      continue;
    }
    if (!current) continue;
    const pieces = line.split(OPTION_SPLIT_RE);
    if (pieces.every((piece) => OPTION_RE.test(piece))) {
      pieces.forEach((piece) => addOption(piece, bold));
    } else if (lastOption) {
      lastOption.text = `${lastOption.text} ${line}`.trim();
    } else {
      current.text = `${current.text} ${line}`.trim();
    }
  }

  return questions
    .filter((q) => q.text && q.options.length >= 2 && q.options.every((option) => option.text))
    .map((q) => {
      const marked = q.options.flatMap((option, index) => (option.marked ? [index] : []));
      const bolded = q.options.flatMap((option, index) => (option.bold ? [index] : []));
      let correct = null;
      if (marked.length === 1) [correct] = marked;
      else if (!marked.length && bolded.length === 1) [correct] = bolded;
      else if (!marked.length && key.has(q.number) && key.get(q.number) < q.options.length) correct = key.get(q.number);
      return { text: q.text, options: q.options.map((option) => option.text), correct };
    });
}

// Returns clean questions, or null if the list cannot be stored. allowMissing permits correct: null.
function normalizeQuestions(value, { allowMissing = false } = {}) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_QUESTIONS) return null;
  const result = [];
  for (const item of value) {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!text || text.length > MAX_QUESTION_LENGTH || !Array.isArray(item.options)) return null;
    const options = item.options.map((option) => (typeof option === 'string' ? option.trim() : ''));
    if (options.length < 2 || options.length > MAX_OPTIONS) return null;
    if (options.some((option) => !option || option.length > MAX_OPTION_LENGTH)) return null;
    const correct = item.correct;
    const validCorrect = Number.isInteger(correct) && correct >= 0 && correct < options.length;
    if (!validCorrect && !(allowMissing && correct === null)) return null;
    result.push({ text, options, correct });
  }
  return result;
}

function quizVersion(questions) {
  return createHash('sha256').update(JSON.stringify(questions)).digest('hex').slice(0, 16);
}

function shuffled(length, seed) {
  return Array.from({ length }, (_, index) => ({
    index,
    rank: createHash('sha256').update(`${seed}:${index}`).digest('hex')
  }))
    .sort((a, b) => (a.rank < b.rank ? -1 : 1))
    .map((item) => item.index);
}

// Derived from the student and module, so a reload shows the same paper and nothing extra is stored.
function buildPaper(questions, userId, moduleId) {
  const seed = `${userId}:${moduleId}:${quizVersion(questions)}`;
  return shuffled(questions.length, `${seed}:questions`).map((questionIndex) => ({
    questionIndex,
    optionOrder: shuffled(questions[questionIndex].options.length, `${seed}:options:${questionIndex}`)
  }));
}

// Positions only: original indexes would reveal where the author placed the correct answer.
function studentPaper(questions, userId, moduleId) {
  return {
    version: quizVersion(questions),
    questions: buildPaper(questions, userId, moduleId).map(({ questionIndex, optionOrder }) => ({
      text: questions[questionIndex].text,
      options: optionOrder.map((index) => questions[questionIndex].options[index])
    }))
  };
}

// answers[i] is the chosen option position in the i-th question as this student saw it.
function gradeAnswers(questions, userId, moduleId, answers) {
  const paper = buildPaper(questions, userId, moduleId);
  if (!Array.isArray(answers) || answers.length !== paper.length) return null;
  const detail = [];
  for (const [position, entry] of paper.entries()) {
    const chosen = answers[position];
    if (!Number.isInteger(chosen) || chosen < 0 || chosen >= entry.optionOrder.length) return null;
    const question = questions[entry.questionIndex];
    const original = entry.optionOrder[chosen];
    detail.push({
      question: question.text,
      chosen: question.options[original],
      right: question.options[question.correct],
      correct: original === question.correct
    });
  }
  return { correct: detail.filter((item) => item.correct).length, total: detail.length, detail };
}

module.exports = {
  buildPaper, extractDocumentText, gradeAnswers, normalizeQuestions, parseTests, quizVersion, studentPaper, toAiText
};
