import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Award, Check, CircleCheck, FileQuestion, LogIn, MessageSquare, Pencil, Plus, Send, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FileCard } from '../../components/FileCard';
import { PageSkeleton } from '../../components/Skeleton';
import { FilePicker } from '../../components/FilePicker';
import { UploadProgress } from '../../components/UploadProgress';
import { api } from '../../lib/api';
import { DOCUMENT_ACCEPT, uploadFile } from '../../lib/files';
import { cx, youTubeEmbedUrl } from '../../lib/format';
import { keys, queryClient, useContent, useModules, useMyProgress } from '../../lib/queries';
import { STEP_TYPES, canManage, stepHasMaterial, type StepType } from '../../lib/steps';
import { openAuth, showSection, showToast, useApp } from '../../store';
import type { Progress, Review, StepContent, StudentPaper } from '../../types';

const LETTERS = 'ABCDEFGH';

function ReviewBox({ review }: { review?: Review | null }) {
  if (!review?.feedback) return null;
  return (
    <div className="teacher-review-box">
      <h5><MessageSquare/> O‘qituvchi xulosasi ({review.teacher_name || 'Ustoz'}):</h5>
      <p>{review.feedback}</p>
    </div>
  );
}

function NoMaterial() {
  return <p className="muted-text">O‘qituvchi bu qadam uchun hali material qo‘shmagan.</p>;
}

function MissingMaterial({ step, onAdd }: { step: StepType; onAdd: () => void }) {
  const noun = step.kind === 'quiz' ? 'test' : 'material';
  return (
    <section className="rounded-2xl border border-dashed border-danger/50 bg-surface p-6 text-center sm:p-10">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-danger/10 text-danger"><FileQuestion className="size-7"/></span>
      <h3 className="mt-4 text-xl font-bold">Bu qadamga {noun} qo‘shilmagan</h3>
      <p className="mx-auto mt-2 max-w-md text-[15px] text-muted">Talabalar bu qadamni bajara olishi uchun avval {noun} biriktiring.</p>
      <button type="button" className="btn-primary mt-6" onClick={onAdd}><Plus/> {noun === 'test' ? 'Test qo‘shish' : 'Material qo‘shish'}</button>
    </section>
  );
}

export function Lesson({ moduleId, isPublic = false }: { moduleId: number | null; isPublic?: boolean }) {
  const user = useApp((state) => state.user);
  const lessonPreview = useApp((state) => state.lessonPreview);
  const lessonFocus = useApp((state) => state.lessonFocus);
  const modules = useModules();
  const module = modules.data?.find((item) => Number(item.id) === Number(moduleId)) ?? modules.data?.[0] ?? null;
  const content = useContent(module?.id ?? null);
  const myProgress = useMyProgress();

  const isStudent = user?.role === 'student';
  const owns = canManage(user, module);
  const editing = Boolean(user) && !isStudent && owns && !lessonPreview;
  const progress: Progress | undefined = module ? myProgress.data?.[module.id] : undefined;
  const completed = progress?.completed_steps ?? [];
  const responses = progress?.step_responses ?? {};
  const contents = content.data ?? {};
  const firstOpen = STEP_TYPES.findIndex((step) => !completed.includes(step.id));
  const readyCount = STEP_TYPES.filter((step) => stepHasMaterial(contents[step.id])).length;

  const [active, setActive] = useState<number | null>(null);
  const [answer, setAnswer] = useState('');
  const [response, setResponse] = useState('');
  const [picked, setPicked] = useState<File | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<(number | null)[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);

  // A new module (or a switch between edit and preview) picks its starting step once data is in.
  const ready = Boolean(module) && content.isSuccess && (!isStudent || myProgress.isSuccess);
  useEffect(() => {
    if (!ready) return;
    let target = 0;
    if (lessonFocus !== null) target = lessonFocus;
    else if (isStudent) target = firstOpen >= 0 ? firstOpen : STEP_TYPES.length - 1;
    else if (editing) target = Math.max(STEP_TYPES.findIndex((step) => !stepHasMaterial(contents[step.id])), 0);
    setActive(target);
    useApp.setState({ lessonFocus: null });
    // Only when the module or mode changes, not on every progress update.
  }, [ready, module?.id, lessonPreview]);

  const stepIndex = active ?? 0;
  const step = STEP_TYPES[stepIndex]!;
  const stepContent: StepContent = contents[step.id] ?? {};
  const isDone = completed.includes(step.id);
  const hasMaterial = stepHasMaterial(stepContent);
  const myResponse = typeof responses[step.id] === 'string' ? (responses[step.id] as string) : '';
  const myFile = step.id === 'task' ? responses.task_file : null;
  const questionCount = stepContent.questions_count || stepContent.questions?.length || 0;

  // Fresh inputs for every step.
  useEffect(() => {
    setAnswer('');
    setResponse(myResponse);
    setPicked(null);
    setQuizAnswers([]);
    setUploadPercent(null);
    document.querySelector('.lesson-main')?.scrollTo(0, 0);
  }, [stepIndex, module?.id]);

  const paper = useQuery({
    queryKey: ['paper', module?.id],
    enabled: Boolean(module) && isStudent && step.id === 'diag' && !isDone && questionCount > 0,
    queryFn: () => api<StudentPaper>(`/quiz?module_id=${module!.id}`)
  });

  const views = useMemo(() => STEP_TYPES.map((item, index) => {
    const done = isStudent && completed.includes(item.id);
    const locked = isStudent && index > 0 && !completed.includes(STEP_TYPES[index - 1]!.id);
    const itemReady = stepHasMaterial(contents[item.id]);
    let state = '';
    let mark: ReactNode = String(index + 1);
    let status = 'Ko‘rish';
    if (isStudent) {
      status = done ? 'Bajarildi' : (index === firstOpen ? 'Hozirgi qadam' : 'Navbatda');
      if (done) { state = 'completed'; mark = <Check/>; }
    } else if (editing) {
      state = itemReady ? 'ready' : 'missing';
      status = itemReady ? 'Tayyor' : 'Material yo‘q';
      mark = itemReady ? <Check/> : <TriangleAlert/>;
    }
    return { state, mark, status, locked };
  }), [isStudent, editing, completed, contents, firstOpen]);

  if (modules.isLoading || (module && !content.isSuccess)) {
    return <PageSkeleton/>;
  }
  if (!module) {
    return <div className="card"><p className="text-muted">Modul topilmadi yoki hali qo‘shilmagan.</p></div>;
  }

  const select = (index: number) => { if (index !== stepIndex) setActive(index); };
  const openEditor = () => useApp.setState({ contentModal: { moduleId: module.id, stepId: step.id } });

  async function complete() {
    if (!user) return openAuth('login');
    const payload: Record<string, unknown> = { module_id: module!.id, step_type: step.id, response: '' };
    if (step.id === 'diag' && paper.data) {
      const answers = paper.data.questions.map((_, index) => quizAnswers[index] ?? null);
      const unanswered = answers.findIndex((value) => value === null);
      if (unanswered >= 0) return showToast(`Iltimos, ${unanswered + 1}-savolga javob bering.`, 'warning');
      Object.assign(payload, { answers, version: paper.data.version });
    } else if (step.id === 'diag') {
      if (!answer.trim()) return showToast('Iltimos, javobni kiriting.', 'warning');
      payload.response = answer.trim();
    }
    if (step.id === 'task' || step.id === 'refl') payload.response = response.trim();
    if (step.id === 'refl' && !payload.response) return showToast('Iltimos, javob matnini kiriting.', 'warning');
    if (step.id === 'task' && !payload.response && !picked) return showToast('Iltimos, javob yozing yoki fayl biriktiring.', 'warning');

    setBusy(true);
    try {
      if (step.id === 'task' && picked) {
        const file = await uploadFile(picked, { moduleId: module!.id, stepType: 'task', purpose: 'submission' }, setUploadPercent);
        payload.file_id = file.id;
      }
      const saved = await api<Progress>('/progress', 'POST', payload);
      queryClient.setQueryData<Record<number, Progress>>(keys.myProgress, (old) => ({ ...(old ?? {}), [module!.id]: saved }));
      const result = saved.step_responses?.diag_result;
      if (step.id === 'diag' && result) showToast(`Natija: ${result.correct}/${result.total} (+${result.score} ball)`, 'success');
      else if (step.id === 'diag') showToast(saved.step_responses?.diag_correct ? 'To‘g‘ri javob! +15 ball' : 'Javobingiz qabul qilindi (0 ball).', saved.step_responses?.diag_correct ? 'success' : 'info');
      else showToast('Qadam muvaffaqiyatli bajarildi!', 'success');
      const nextOpen = STEP_TYPES.findIndex((item) => !saved.completed_steps.includes(item.id));
      setActive(nextOpen >= 0 ? nextOpen : STEP_TYPES.length - 1);
    } catch (error) {
      showToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
      setUploadPercent(null);
    }
  }

  const actionButton = (icon: ReactNode, label: string) => (
    <button type="button" data-step-action className="btn-primary" disabled={busy} onClick={complete}>{icon} {label}</button>
  );

  // ===== Step body and its main action =====
  let body: ReactNode = null;
  let action: ReactNode = null;
  const note = stepContent.value ? <div className="step-text">{stepContent.value}</div> : null;

  if (step.kind === 'quiz') {
    if (questionCount) {
      if (isStudent && !isDone && paper.data) {
        body = paper.data.questions.map((question, index) => (
          <fieldset key={index} className="student-question">
            <legend>{index + 1}. {question.text}</legend>
            {question.options.map((option, optionIndex) => (
              <label key={optionIndex} className="quiz-option">
                <input type="radio" name={`studentQ${index}`} value={optionIndex} checked={quizAnswers[index] === optionIndex}
                  onChange={() => setQuizAnswers((old) => { const next = [...old]; next[index] = optionIndex; return next; })}/>
                <span>{LETTERS[optionIndex]}) {option}</span>
              </label>
            ))}
          </fieldset>
        ));
        action = actionButton(<Check/>, 'Testni yakunlash');
      } else {
        body = <p className="muted-text">{questionCount} ta test savoli. Har bir talabada savollar va javoblar tartibi boshqacha.</p>;
      }
    } else if (hasMaterial) {
      body = (
        <>
          <div className="quiz-question">{stepContent.value}</div>
          <label htmlFor="stepAnswer" className="step-label">Javobingiz</label>
          <input id="stepAnswer" className="step-input" type="text" maxLength={500} placeholder="Javobni shu yerga yozing..." autoComplete="off" value={answer} onChange={(e) => setAnswer(e.target.value)}/>
        </>
      );
      action = actionButton(<Check/>, 'Javobni yuborish');
    } else {
      body = <NoMaterial/>;
    }
  } else if (step.kind === 'video') {
    const embed = stepContent.value ? youTubeEmbedUrl(stepContent.value) : null;
    body = embed ? (
      <>
        <div className="video-container relative h-0 overflow-hidden bg-black pb-[56.25%]">
          <iframe title="Video dars" loading="lazy" className="absolute top-0 left-0 h-full w-full border-0" src={embed} allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen/>
        </div>
        <p className="muted-text mt-5">Videodarsni to‘liq ko‘rib bo‘lgach, quyidagi tugmani bosib qadamni yakunlang.</p>
      </>
    ) : <NoMaterial/>;
    if (embed) action = actionButton(<CircleCheck/>, 'Ko‘rib bo‘ldim');
  } else if (step.kind === 'doc') {
    body = hasMaterial ? <><FileCard file={stepContent.file}/>{note}</> : <NoMaterial/>;
    if (hasMaterial) action = actionButton(<CircleCheck/>, 'O‘qib chiqdim');
  } else if (step.kind === 'upload') {
    body = (
      <>
        <div className="step-text">{stepContent.value || 'Amaliy topshiriqni bajaring va javobingizni yozing yoki fayl sifatida yuklang.'}</div>
        <FileCard file={stepContent.file}/>
        {!isDone && (
          <>
            <label htmlFor="stepResponse" className="step-label">Sizning yechimingiz</label>
            <textarea id="stepResponse" className="step-input" rows={6} maxLength={10000} placeholder="Javobni bu yerga yozing..." value={response} onChange={(e) => setResponse(e.target.value)}/>
            <span className="step-label mt-4">Yoki fayl biriktiring</span>
            <FilePicker id="stepFile" accept={DOCUMENT_ACCEPT} file={picked} onChange={setPicked} hint="PDF, Word, Excel, PowerPoint, matn yoki rasm, 30 MB gacha."/>
            <UploadProgress percent={uploadPercent}/>
          </>
        )}
      </>
    );
    action = actionButton(<Send/>, 'Topshirish');
  } else {
    body = (
      <>
        <div className="step-text">{stepContent.value || 'Ushbu modul davomida nimalarni o‘rgandingiz va ularni qanday qo‘llashni rejalashtirdingiz?'}</div>
        <label htmlFor="stepResponse" className="step-label">Sizning refleksiyangiz</label>
        <textarea id="stepResponse" className="step-input" rows={6} maxLength={10000} placeholder="Refleksiyangizni bu yerga yozing..." value={response} onChange={(e) => setResponse(e.target.value)}/>
      </>
    );
    action = actionButton(<Send/>, 'Refleksiyani yuborish');
  }

  if (!user) {
    action = <button type="button" className="btn-primary" onClick={() => openAuth('login')}><LogIn/> Davom etish uchun kiring</button>;
  } else if (isStudent && isDone) {
    if (myResponse || myFile) {
      const result = responses.diag_result;
      const badge = step.id !== 'diag' ? null : result
        ? <span className="badge badge-primary ml-2">+{result.score} ball</span>
        : responses.diag_correct ? <span className="badge badge-success ml-2">To‘g‘ri (+15 ball)</span> : <span className="badge badge-muted ml-2">Qabul qilindi (0 ball)</span>;
      body = (
        <>
          {body}
          <div className="submitted-box">
            <strong className="step-label">Siz topshirgan javob: {badge}</strong>
            {myResponse && <div className="text-sm whitespace-pre-wrap">{myResponse}</div>}
            <FileCard file={myFile}/>
          </div>
          <ReviewBox review={responses.reviews?.[step.id]}/>
        </>
      );
    }
    action = null;
  } else if (!isStudent) {
    action = null;
    if (editing) {
      if (!hasMaterial) body = <MissingMaterial step={step} onAdd={openEditor}/>;
      else action = <button type="button" className="btn-outline" onClick={openEditor}><Pencil/> Tahrirlash</button>;
    }
  }

  const canGoNext = stepIndex < STEP_TYPES.length - 1 && (!isStudent || isDone);
  const navButton = (index: number, label: string, solid: boolean) => (
    <button type="button" className={solid ? 'btn-primary' : 'btn-outline'} aria-label={label} onClick={() => select(index)}>
      {solid ? <><span>{label}</span><ArrowRight/></> : <><ArrowLeft/><span className="max-lg:hidden">{label}</span></>}
    </button>
  );

  const meter = editing ? { label: 'Tayyorlik', count: readyCount, fill: 'bg-success' } : { label: 'Jarayon', count: completed.length, fill: 'bg-primary' };
  const isAllDone = completed.length >= 6;

  return (
    <>
      {isPublic && (
        <button type="button" className="back-btn" onClick={() => showSection('public-modules')}><ArrowLeft/> Modullar ro‘yxatiga qaytish</button>
      )}
      <div className={cx('lesson', isPublic && 'lesson-public')}>
        <aside className="lesson-rail">
          <div className="border-b border-line p-5">
            <p className="text-sm font-medium text-primary">Modul {Number(module.order_num)}</p>
            <p className="mt-0.5 text-lg leading-snug font-bold wrap-anywhere">{module.title}</p>
            {module.description && <p className="mt-1.5 line-clamp-3 text-sm text-muted">{module.description}</p>}
            {(editing || isStudent) && (
              <>
                <div className="mt-4 flex justify-between text-sm"><span className="text-muted">{meter.label}</span><span className="font-semibold tabular-nums">{meter.count} / 6 qadam</span></div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${meter.fill}`} style={{ width: `${Math.round((meter.count / 6) * 100)}%` }}/></div>
              </>
            )}
          </div>
          <ol className={cx('steps-list', isStudent && 'steps-progress')}>
            {STEP_TYPES.map((item, index) => {
              const view = views[index]!;
              return (
                <li key={item.id} className="relative">
                  <button type="button" className={cx('step-item', view.state, index === stepIndex && 'active')} data-step-index={index}
                    aria-current={index === stepIndex ? 'step' : undefined} disabled={view.locked} title={view.locked ? 'Oldingi qadamni yakunlang' : undefined} onClick={() => select(index)}>
                    <span className="step-mark">{view.mark}</span>
                    <span className="min-w-0"><span className="step-name">{item.name}</span><span className="step-status">{view.status}</span></span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
        <nav className="lesson-strip" aria-label="Qadamlar">
          {STEP_TYPES.map((item, index) => {
            const view = views[index]!;
            return (
              <button key={item.id} type="button" className={cx('step-chip', view.state, index === stepIndex && 'active')} data-step-index={index}
                aria-current={index === stepIndex ? 'step' : undefined} disabled={view.locked} aria-label={`${index + 1}-qadam: ${item.name}, ${view.status}`} onClick={() => select(index)}>
                <span className="step-mark">{view.mark}</span>
              </button>
            );
          })}
        </nav>
        <section className="lesson-main">
          <div className="lesson-content">
            {isAllDone && isStudent && (
              <div className="celebration-box">
                <div className="mb-2 text-primary"><Award className="h-12 w-12"/></div>
                <h3>Tabriklaymiz! Siz ushbu modulni muvaffaqiyatli tamomladingiz!</h3>
                <p className="text-sm text-muted">Barcha 6 ta didaktik qadam to‘liq yakunlandi va tizimda qayd etildi.</p>
              </div>
            )}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p id="stepEyebrow" className="text-sm font-semibold text-primary">{stepIndex + 1}-qadam, jami {STEP_TYPES.length} ta</p>
                <h2 id="stepHeading" className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{step.name}</h2>
              </div>
              {user && !isStudent && owns && (
                <div className="segmented" role="group" aria-label="Ko‘rinish rejimi">
                  <button type="button" aria-pressed={!lessonPreview} onClick={() => useApp.setState({ lessonPreview: false, lessonFocus: stepIndex })}>Tahrirlash</button>
                  <button type="button" id="lessonPreviewBtn" aria-pressed={lessonPreview} onClick={() => useApp.setState({ lessonPreview: true, lessonFocus: stepIndex })}>Talaba ko‘rinishi</button>
                </div>
              )}
            </div>
            {user && !isStudent && !owns && (
              <p className="mt-4 rounded-xl bg-primary/10 px-4 py-3 text-sm text-ink">Bu modulni boshqa o‘qituvchi yaratgan. Uni faqat muallif yoki administrator tahrirlay oladi.</p>
            )}
            <div id="stepBody" className="mt-5">{body}</div>
            <div id="stepFooter" className="lesson-actions">
              {stepIndex > 0 && navButton(stepIndex - 1, 'Oldingi qadam', false)}
              <div className="ml-auto flex min-w-0 items-center gap-2">
                <span id="stepAction" className="contents">{action}</span>
                {canGoNext && navButton(stepIndex + 1, 'Keyingi qadam', true)}
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
