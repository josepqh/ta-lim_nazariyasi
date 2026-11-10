import { Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { uploadFile } from '../lib/files';
import { showToast } from '../store';
import type { QuizQuestion } from '../types';
import { FilePicker } from './FilePicker';

const LETTERS = 'ABCDEFGH';
const MAX_SOURCE_SIZE = 30 * 1024 * 1024;
const HINT_PARSED = 'To‘g‘ri javob * yoki +, qalin yozuv yoki fayl oxiridagi kalit (1-A, 2-C) bilan olinadi. Belgilanmagan bo‘lsa, AI o‘zi aniqlaydi.';
const HINT_GENERATE = 'AI faqat fayldagi ma’lumotga tayanib test tuzadi. Saqlashdan oldin tekshirib chiqing.';

export interface QuizMeta {
  source?: 'file' | 'ai';
  answered_by_ai?: number;
  truncated?: boolean;
}

export const quizReady = (questions: QuizQuestion[]) => questions.length > 0 && questions.every((q) => Number.isInteger(q.correct));

interface Props {
  prefix: 'new' | 'modal';
  questions: QuizQuestion[];
  onChange: (questions: QuizQuestion[]) => void;
}

// Reads a test from a .docx/.pdf (or has AI write one) and lets the teacher fix the answers before saving.
export function QuizBuilder({ prefix, questions, onChange }: Props) {
  const [mode, setMode] = useState<'parsed' | 'generate'>('parsed');
  const [file, setFile] = useState<File | null>(null);
  const [count, setCount] = useState('10');
  const [meta, setMeta] = useState<QuizMeta>({});
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare() {
    const fail = (message: string, id: string) => {
      showToast(message, 'warning');
      document.getElementById(id)?.focus();
    };
    if (!file) return fail('Avval .docx yoki .pdf faylni tanlang.', `${prefix}QuizFile`);
    if (!/\.(docx|pdf)$/i.test(file.name)) return fail('Faqat .docx yoki .pdf fayl yuklang.', `${prefix}QuizFile`);
    if (file.size > MAX_SOURCE_SIZE) return fail('Fayl hajmi 30 MB dan oshmasin.', `${prefix}QuizFile`);
    const total = Number(count);
    if (mode === 'generate' && (!Number.isInteger(total) || total < 1 || total > 30)) return fail('Testlar soni 1 dan 30 gacha bo‘lsin.', `${prefix}QuizCount`);

    setBusy(true);
    setStatus({ text: mode === 'generate' ? 'AI test tuzmoqda…' : 'Fayl o‘qilmoqda…' });
    try {
      const uploaded = await uploadFile(file, { stepType: 'diag', purpose: 'quiz_source' });
      const result = await api<QuizMeta & { questions: QuizQuestion[] }>('/quiz', 'POST', { action: 'extract', file_id: uploaded.id, mode, count: total });
      setMeta(result);
      onChange(result.questions);
      setStatus(null);
    } catch (error) {
      setStatus({ text: (error as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  const setCorrect = (index: number, optionIndex: number) =>
    onChange(questions.map((q, i) => (i === index ? { ...q, correct: optionIndex, ai_marked: false } : q)));
  const remove = (index: number) => onChange(questions.filter((_, i) => i !== index));
  const missing = questions.filter((q) => !Number.isInteger(q.correct)).length;

  return (
    <div className="quiz-builder">
      <div className="quiz-mode" role="radiogroup" aria-label="Fayl turi">
        <label><input type="radio" name={`${prefix}QuizMode`} value="parsed" checked={mode === 'parsed'} onChange={() => setMode('parsed')}/> Faylda tayyor testlar bor</label>
        <label><input type="radio" name={`${prefix}QuizMode`} value="generate" checked={mode === 'generate'} onChange={() => setMode('generate')}/> Faylda faqat ma’lumot bor, AI test tuzsin</label>
      </div>
      <div className="form-group">
        <span className="form-label">Fayl (.docx yoki .pdf)</span>
        <FilePicker id={`${prefix}QuizFile`} accept=".docx,.pdf" file={file} onChange={setFile} hint={mode === 'generate' ? HINT_GENERATE : HINT_PARSED}/>
      </div>
      {mode === 'generate' && (
        <div className="form-group">
          <label htmlFor={`${prefix}QuizCount`}>Testlar soni (1–30)</label>
          <input type="number" id={`${prefix}QuizCount`} min={1} max={30} value={count} onChange={(e) => setCount(e.target.value)}/>
        </div>
      )}
      <button type="button" className="btn-outline" id={`${prefix}QuizPrepare`} disabled={busy} onClick={prepare}><Sparkles/> Testni tayyorlash</button>
      <div id={`${prefix}QuizPreview`} className="quiz-preview" aria-live="polite">
        {status && (status.error
          ? <p className="input-feedback-error show" role="alert">{status.text}</p>
          : <p className="muted-text">{status.text}</p>)}
        {!status && questions.length > 0 && (
          <>
            <p className="quiz-summary">
              <strong>{questions.length} ta savol.</strong>{' '}
              {missing ? <span className="quiz-missing">{missing} ta savolda to‘g‘ri javobni belgilang.</span> : 'Hammasida to‘g‘ri javob belgilangan.'}
            </p>
            {meta.source === 'ai' && <p className="field-hint">Savollarni AI tayyorladi, xato bo‘lishi mumkin. Tekshirib chiqing.</p>}
            {Boolean(meta.answered_by_ai) && <p className="field-hint">{meta.answered_by_ai} ta savolning to‘g‘ri javobini AI aniqladi, xato bo‘lishi mumkin. Tekshirib chiqing.</p>}
            {meta.truncated && <p className="field-hint">Fayl juda uzun: AI faqat uning boshlang‘ich qismidan foydalandi.</p>}
            <ol className="quiz-list">
              {questions.map((question, index) => (
                <li key={index} className={Number.isInteger(question.correct) ? '' : 'quiz-unset'}>
                  <div className="quiz-question-head">
                    <span>{question.text}{question.ai_marked && <> <span className="badge badge-muted">AI belgiladi</span></>}</span>
                    <button type="button" className="quiz-remove" aria-label={`${index + 1}-savolni o‘chirish`} onClick={() => remove(index)}><Trash2/></button>
                  </div>
                  {question.options.map((option, optionIndex) => (
                    <label key={optionIndex} className="quiz-option">
                      <input type="radio" name={`${prefix}Correct${index}`} checked={question.correct === optionIndex} onChange={() => setCorrect(index, optionIndex)}/>
                      <span>{LETTERS[optionIndex]}) {option}</span>
                    </label>
                  ))}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
