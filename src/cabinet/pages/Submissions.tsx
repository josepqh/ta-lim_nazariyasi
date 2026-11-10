import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, ClipboardCheck, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FileCard } from '../../components/FileCard';
import { api } from '../../lib/api';
import { queryClient, useModules } from '../../lib/queries';
import { STEP_TYPES, canManage } from '../../lib/steps';
import { navigate, setTitle, showToast, useApp } from '../../store';
import type { Module, Progress, Review, StepResponses } from '../../types';

export function QuizResult({ responses }: { responses?: StepResponses }) {
  const result = responses?.diag_result;
  if (!result) return null;
  const detail = Array.isArray(responses?.diag_detail) ? responses!.diag_detail! : [];
  const wrong = detail.filter((item) => !item.correct);
  const right = detail.filter((item) => item.correct);
  return (
    <div className="quiz-result">
      <p className="quiz-result-score"><strong>Test natijasi: {Number(result.correct)}/{Number(result.total)}</strong> &middot; {Number(result.score)} ball</p>
      {wrong.length ? (
        <>
          <p className="quiz-result-label">Xato javoblar ({wrong.length} ta):</p>
          <ol className="quiz-wrong-list">
            {wrong.map((item, index) => (
              <li key={index}>
                <span className="quiz-q">{item.question}</span>
                <span className="quiz-wrong-answer">Talaba javobi: {item.chosen}</span>
                {item.right && <span className="quiz-right-answer">To‘g‘ri javob: {item.right}</span>}
              </li>
            ))}
          </ol>
        </>
      ) : <p className="muted-text">Barcha savollarga to‘g‘ri javob bergan.</p>}
      {right.length > 0 && (
        <details className="quiz-detail">
          <summary>To‘g‘ri javoblar ({right.length} ta)</summary>
          <ol>{right.map((item, index) => <li key={index}>{item.question}<br/><span className="quiz-right-answer">{item.chosen}</span></li>)}</ol>
        </details>
      )}
    </div>
  );
}

export function ReviewNote({ review }: { review?: Review | null }) {
  if (!review?.feedback) return null;
  return (
    <div className="teacher-review-box">
      <h5><MessageSquare/> O‘qituvchi xulosasi ({review.teacher_name || 'Ustoz'}):</h5>
      <p>{review.feedback}</p>
    </div>
  );
}

// Every module, with what one student did in each step.
export function StudentWork({ rows, modules }: { rows: Progress[]; modules: Module[] }) {
  const byModule = new Map(rows.map((row) => [Number(row.module_id), row]));
  return (
    <>
      {modules.map((module) => {
        const row = byModule.get(Number(module.id));
        const heading = <h3>Modul {Number(module.order_num)}. {module.title}</h3>;
        if (!row) {
          return (
            <section key={module.id} className="card work-module">
              <div className="work-module-head">{heading}<span className="badge badge-muted">Boshlanmagan</span></div>
            </section>
          );
        }
        const responses = row.step_responses || {};
        return (
          <section key={module.id} className="card work-module">
            <div className="work-module-head">
              {heading}
              <span className={`badge ${row.completed_steps.length >= 6 ? 'badge-success' : 'badge-primary'}`}>{row.completed_steps.length}/6 qadam &middot; {Number(row.total_score) || 0} ball</span>
            </div>
            <ul className="work-steps">
              {STEP_TYPES.map((step) => {
                const done = row.completed_steps.includes(step.id);
                const answer = responses[step.id];
                const verdict = step.id === 'diag' && done
                  ? (responses.diag_result
                    ? <span className="badge badge-primary">{responses.diag_result.correct}/{responses.diag_result.total}</span>
                    : responses.diag_correct ? <span className="badge badge-success">To‘g‘ri</span> : <span className="badge badge-muted">Noto‘g‘ri</span>)
                  : null;
                return (
                  <li key={step.id} className="work-step">
                    <div className="work-step-head">
                      <span>{step.title}</span>
                      <span className="work-step-badges">{verdict}<span className={`badge ${done ? 'badge-success' : 'badge-muted'}`}>{done ? 'Bajarilgan' : 'Bajarilmagan'}</span></span>
                    </div>
                    {typeof answer === 'string' && answer && !(step.id === 'diag' && responses.diag_result) && <div className="submission-response">{answer}</div>}
                    {step.id === 'diag' && <QuizResult responses={responses}/>}
                    {step.id === 'task' && <FileCard file={responses.task_file}/>}
                    <ReviewNote review={responses.reviews?.[step.id]}/>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function ReviewForm({ row, step, existing }: { row: Progress; step: 'task' | 'refl'; existing: string }) {
  const [feedback, setFeedback] = useState(existing);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!feedback.trim()) return showToast('Iltimos, fikr-mulohazani kiriting.', 'warning');
    setBusy(true);
    try {
      await api('/progress', 'POST', { action: 'review', progress_id: row.id, step, feedback: feedback.trim() });
      showToast('Fikr-mulohaza saqlandi!', 'success');
      await queryClient.invalidateQueries({ queryKey: ['progress', `module:${row.module_id}`] });
    } catch (error) {
      showToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 flex gap-2.5">
      <input type="text" id={`review_input_${row.id}_${step}`} aria-label="Fikr-mulohaza" placeholder="Fikr-mulohaza yoki baho yozing..." className="review-input" value={feedback} onChange={(e) => setFeedback(e.target.value)}/>
      <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}><Check/> Baholash</button>
    </div>
  );
}

const RESPONSE_LABELS = { task: '5. Amaliy topshiriq', refl: '6. Refleksiv hisobot' } as const;

export function Submissions() {
  const user = useApp((state) => state.user)!;
  const modules = useModules();
  const list = modules.data ?? [];
  const [moduleId, setModuleId] = useState<number | null>(null);
  useEffect(() => {
    if (moduleId === null && list.length) setModuleId(list[0]!.id);
  }, [list, moduleId]);
  const module = list.find((item) => item.id === moduleId) ?? null;
  const rows = useQuery({
    queryKey: ['progress', `module:${moduleId}`],
    enabled: moduleId !== null,
    queryFn: () => api<Progress[]>(`/progress?module_id=${moduleId}`)
  });

  if (modules.isSuccess && !list.length) return <div className="card">Javoblarni ko‘rish uchun avval modullar qo‘shing.</div>;
  const mayReview = canManage(user, module);

  const submissions = (rows.data ?? []).flatMap((row) => (['task', 'refl'] as const).flatMap((step) => {
    const response = typeof row.step_responses?.[step] === 'string' ? (row.step_responses[step] as string) : '';
    const file = step === 'task' ? row.step_responses?.task_file : null;
    return response || file?.id ? [{ row, step, response, file }] : [];
  }));
  const quizRows = (rows.data ?? []).filter((row) => row.step_responses?.diag_result);

  return (
    <>
      <div className="card">
        <h3 className="card-title"><ClipboardCheck/> Talaba javoblari va monitoring</h3>
        <div className="form-group">
          <label htmlFor="submissionModule">Modulni tanlang</label>
          <select id="submissionModule" value={moduleId ?? ''} onChange={(event) => setModuleId(Number(event.target.value))}>
            {list.map((item) => <option key={item.id} value={item.id}>{item.order_num}. {item.title}</option>)}
          </select>
        </div>
        {module && !mayReview && <p className="field-hint">Bu modulni boshqa o‘qituvchi yaratgan: javoblarni ko‘rasiz, baholashni esa muallif yoki administrator qiladi.</p>}
      </div>
      <div id="submissionList" aria-live="polite">
        {rows.isLoading && <div className="spinner"/>}
        {rows.isError && <div className="card">Ma'lumotlarni yuklab bo‘lmadi.</div>}
        {rows.isSuccess && !submissions.length && !quizRows.length && (
          <div className="card"><p className="text-muted">Ushbu modul bo‘yicha topshirilgan yozma topshiriqlar hozircha yo‘q.</p></div>
        )}
        {quizRows.map((row) => (
          <article key={`quiz-${row.id}`} className="card submission-card mb-5">
            <div className="submission-heading">
              <div>
                <h3 className="text-lg">{row.student_name || row.student_login || 'Talaba'}</h3>
                <p>{row.module_title || ''} &middot; <span className="badge badge-primary">1. Diagnostika testi</span></p>
              </div>
            </div>
            <QuizResult responses={row.step_responses}/>
          </article>
        ))}
        {submissions.map(({ row, step, response, file }) => {
          const existing = row.step_responses?.reviews?.[step]?.feedback || '';
          return (
            <article key={`${row.id}-${step}`} className="card submission-card mb-5">
              <div className="submission-heading">
                <div>
                  <h3 className="text-lg">{row.student_name || row.student_login || 'Talaba'}</h3>
                  <p>{row.module_title || ''} &middot; <span className="badge badge-primary">{RESPONSE_LABELS[step]}</span></p>
                </div>
                <time>{row.updated_at ? new Date(row.updated_at).toLocaleString('uz-UZ') : ''}</time>
              </div>
              <div className="submission-response">
                <strong>Talaba javobi:</strong>
                {response && <p className="mt-1.5 italic">{response}</p>}
                <FileCard file={file}/>
              </div>
              <div className="teacher-review-box">
                <h5><MessageSquare/> O‘qituvchi fikri va bahosi</h5>
                {existing && <p><strong>Tekshirildi:</strong> {existing}</p>}
                {mayReview && <ReviewForm row={row} step={step} existing={existing}/>}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

export function StudentDetail({ studentId }: { studentId: number | null }) {
  const modules = useModules();
  const rows = useQuery({
    queryKey: ['progress', `student:${studentId}`],
    enabled: Boolean(studentId),
    queryFn: () => api<Progress[]>(`/progress?user_id=${studentId}`)
  });
  const name = rows.data?.[0]?.student_name || rows.data?.[0]?.student_login || 'Talaba';
  useEffect(() => {
    if (rows.isSuccess) setTitle(name);
  }, [rows.isSuccess, name]);

  if (rows.isLoading || modules.isLoading) return <div className="spinner"/>;
  if (rows.isError) return <div className="card">Ma'lumotlarni yuklab bo‘lmadi.</div>;
  return (
    <>
      <button type="button" className="back-btn" onClick={() => navigate('analytics')}><ArrowLeft/> Tahlilga qaytish</button>
      <div className="card">
        <h3 className="card-title mb-1.5 border-0 p-0">{name}</h3>
        <p className="muted-text">{rows.data?.[0]?.student_login || ''} &middot; Modullar kesimida bajarilgan ishlar</p>
      </div>
      <StudentWork rows={rows.data ?? []} modules={modules.data ?? []}/>
    </>
  );
}
