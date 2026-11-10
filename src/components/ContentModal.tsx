import { Save, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { DOCUMENT_ACCEPT, uploadFile } from '../lib/files';
import { cx, youTubeEmbedUrl } from '../lib/format';
import { keys, queryClient } from '../lib/queries';
import { STEP_TYPES } from '../lib/steps';
import { showToast, useApp } from '../store';
import type { ContentRow, QuizQuestion, StepId, StoredFile } from '../types';
import { FileCard } from './FileCard';
import { FilePicker } from './FilePicker';
import { QuizBuilder, quizReady } from './QuizBuilder';
import { UploadProgress } from './UploadProgress';
import { useModal } from './useModal';

const FILE_ACCEPT: Partial<Record<StepId, string>> = { pres: '.pptx', doc: DOCUMENT_ACCEPT, task: DOCUMENT_ACCEPT };
const FILE_HINT: Partial<Record<StepId, string>> = {
  pres: 'Faqat PowerPoint (.pptx), 30 MB gacha.',
  doc: 'PDF, Word, Excel, PowerPoint, matn yoki rasm, 30 MB gacha.',
  task: 'Ixtiyoriy: topshiriqqa ilova. PDF, Word, Excel, PowerPoint, matn yoki rasm, 30 MB gacha.'
};

// The teacher's editor for one step of one module.
export function ContentModal() {
  const target = useApp((state) => state.contentModal);
  const open = Boolean(target);
  const boxRef = useModal<HTMLDivElement>(open);
  const [loaded, setLoaded] = useState(false);
  const [value, setValue] = useState('');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [existingFile, setExistingFile] = useState<StoredFile | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoaded(false);
    setPicked(null);
    setPercent(null);
    api<ContentRow[]>(`/content?module_id=${target.moduleId}`)
      .then((rows) => {
        if (cancelled) return;
        const existing = rows.find((row) => row.step_type === target.stepId)?.content ?? {};
        setValue(existing.value ?? '');
        setQuestions(Array.isArray(existing.questions) ? existing.questions.map((q) => ({ ...q })) : []);
        setExistingFile(existing.file ?? null);
        setLoaded(true);
      })
      .catch((error: Error) => {
        showToast(error.message, 'error');
        close();
      });
    return () => { cancelled = true; };
  }, [target]);

  function close() {
    useApp.setState({ contentModal: null });
  }

  const stepId = (target?.stepId ?? 'diag') as StepId;
  const step = STEP_TYPES.find((item) => item.id === stepId);
  const fileStep = stepId === 'pres' || stepId === 'doc' || stepId === 'task';

  async function save() {
    if (!target) return;
    const usesFileAsMaterial = stepId === 'pres' || stepId === 'doc';
    const text = value.trim();
    if (usesFileAsMaterial && !picked && !existingFile) return showToast('Iltimos, faylni tanlang.', 'warning');
    if (!usesFileAsMaterial && stepId !== 'diag' && !text) return showToast('Iltimos, material matnini kiriting.', 'warning');
    const content: Record<string, unknown> = { value: text };
    if (stepId === 'diag') {
      if (!quizReady(questions)) return showToast('Testni tayyorlang va har savolda to‘g‘ri javobni belgilang.', 'warning');
      content.questions = questions;
    }
    if (stepId === 'video' && !youTubeEmbedUrl(text)) return showToast('Noto‘g‘ri YouTube havolasi! Iltimos, to‘g‘ri YouTube URL kiriting.', 'error');

    setBusy(true);
    try {
      if (fileStep) {
        const file = picked ? await uploadFile(picked, { moduleId: target.moduleId, stepType: stepId, purpose: 'content' }, setPercent) : existingFile;
        content.file_id = file ? file.id : null;
      }
      await api('/content', 'POST', { module_id: target.moduleId, step_type: stepId, content });
      await queryClient.invalidateQueries({ queryKey: keys.content(target.moduleId) });
      showToast('Material muvaffaqiyatli saqlandi!', 'success');
      useApp.setState({ lessonFocus: STEP_TYPES.findIndex((item) => item.id === stepId) });
      close();
    } catch (error) {
      showToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const fileField = (
    <div className="form-group">
      <span className="form-label">{stepId === 'pres' ? 'Taqdimot fayli (.pptx)' : 'Fayl'}</span>
      {existingFile && (
        <div className="current-file" id="currentFileRow">
          <FileCard file={existingFile}/>
          {stepId === 'task' && <button type="button" className="btn-danger" onClick={() => setExistingFile(null)}><Trash2/> Olib tashlash</button>}
        </div>
      )}
      <FilePicker id="teacherUploadFile" accept={FILE_ACCEPT[stepId] ?? DOCUMENT_ACCEPT} file={picked} onChange={setPicked}
        hint={`${FILE_HINT[stepId] ?? ''}${existingFile ? ' Yangi fayl tanlasangiz, eskisi almashtiriladi.' : ''}`}/>
      <UploadProgress percent={percent}/>
    </div>
  );

  return (
    <div id="stepModal" className={cx('modal-overlay modal-shell', open && 'active')} role="dialog" aria-modal="true" aria-labelledby="modalTitle"
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={boxRef} className="modal-box">
        <div className="modal-header">
          <h3 id="modalTitle">{step ? `${step.title} — Material biriktirish` : 'Material biriktirish'}</h3>
          <button type="button" onClick={close} className="grid size-11 place-items-center rounded-lg text-2xl text-muted transition-colors hover:text-ink" aria-label="Yopish">&times;</button>
        </div>
        <div id="modalBody" className="modal-body">
          {!loaded ? <div className="spinner"/> : (
            <>
              {stepId === 'video' && (
                <div className="form-group">
                  <label htmlFor="teacherUploadVal">YouTube video havolasi (URL)</label>
                  <input type="url" id="teacherUploadVal" placeholder="https://www.youtube.com/watch?v=..." value={value} onChange={(e) => setValue(e.target.value)}/>
                  <small className="field-hint">Masalan: https://youtube.com/watch?v=... yoki https://youtu.be/...</small>
                </div>
              )}
              {stepId === 'diag' && <QuizBuilder prefix="modal" questions={questions} onChange={setQuestions}/>}
              {(stepId === 'pres' || stepId === 'doc') && (
                <>
                  {fileField}
                  <div className="form-group">
                    <label htmlFor="teacherUploadVal">Qisqacha izoh (ixtiyoriy)</label>
                    <textarea id="teacherUploadVal" rows={3} maxLength={30000} placeholder="Fayl haqida talabalarga izoh..." value={value} onChange={(e) => setValue(e.target.value)}/>
                  </div>
                </>
              )}
              {(stepId === 'task' || stepId === 'refl') && (
                <>
                  <div className="form-group">
                    <label htmlFor="teacherUploadVal">Ko‘rsatma matni</label>
                    <textarea id="teacherUploadVal" rows={6} value={value} onChange={(e) => setValue(e.target.value)}
                      placeholder={stepId === 'task' ? 'Talaba bajarishi kerak bo‘lgan amaliy topshiriq matni...' : 'Refleksiya uchun yo‘naltiruvchi savollar...'}/>
                  </div>
                  {stepId === 'task' && fileField}
                </>
              )}
            </>
          )}
        </div>
        <div className="modal-footer" id="modalFooter">
          {loaded && (
            <>
              <button type="button" className="btn-outline" onClick={close}><X/> Bekor qilish</button>
              <button type="button" className="btn-primary" id="teacherSaveBtn" disabled={busy} onClick={save}><Save/> Saqlash</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
