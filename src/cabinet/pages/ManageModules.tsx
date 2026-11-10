import { useQuery } from '@tanstack/react-query';
import { Archive, CircleHelp, CirclePlay, Feather, FileText, Layers, Lock, Pencil, PencilLine, Presentation, RotateCcw, Save, Trash2, UploadCloud, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { FilePicker } from '../../components/FilePicker';
import { QuizBuilder, quizReady } from '../../components/QuizBuilder';
import { api } from '../../lib/api';
import { DOCUMENT_ACCEPT, uploadFile } from '../../lib/files';
import { youTubeEmbedUrl } from '../../lib/format';
import { keys, queryClient, refreshModules, useModules } from '../../lib/queries';
import { canManage } from '../../lib/steps';
import { showToast, useApp } from '../../store';
import type { Module, QuizQuestion, StepId } from '../../types';
import { StaffModuleTabs } from './Modules';

const STEP_BUTTONS: { id: StepId; label: string; icon: ReactNode }[] = [
  { id: 'diag', label: 'Test savoli', icon: <CircleHelp/> },
  { id: 'video', label: 'Video (URL)', icon: <CirclePlay/> },
  { id: 'pres', label: 'Taqdimot', icon: <Presentation/> },
  { id: 'doc', label: 'Qo‘shimcha matn', icon: <FileText/> },
  { id: 'task', label: 'Topshiriq', icon: <UploadCloud/> },
  { id: 'refl', label: 'Refleksiya', icon: <Feather/> }
];

function fail(message: string, id: string): false {
  showToast(message, 'warning');
  document.getElementById(id)?.focus();
  return false;
}

export function ManageModules() {
  const user = useApp((state) => state.user)!;
  const editId = useApp((state) => state.editModuleId);
  const modules = useModules();
  const list = modules.data ?? [];
  const editing = editId ? list.find((module) => module.id === editId) ?? null : null;

  const [order, setOrder] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [video, setVideo] = useState('');
  const [presFile, setPresFile] = useState<File | null>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docNote, setDocNote] = useState('');
  const [task, setTask] = useState('');
  const [taskFile, setTaskFile] = useState<File | null>(null);
  const [refl, setRefl] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  // The form follows the module being edited; a new module gets the next free position.
  useEffect(() => {
    setOrder(String(editing ? editing.order_num : list.length + 1));
    setTitle(editing?.title ?? '');
    setDescription(editing?.description ?? '');
  }, [editId, list.length]);

  const deleted = useQuery({ queryKey: keys.deletedModules, queryFn: () => api<Module[]>('/modules?deleted=1') });

  function resetForm() {
    useApp.setState({ editModuleId: null });
    setQuestions([]);
    setVideo('');
    setPresFile(null);
    setDocFile(null);
    setDocNote('');
    setTask('');
    setTaskFile(null);
    setRefl('');
    setStatus('');
    setFormKey((key) => key + 1);
  }

  function validateSteps(): boolean {
    if (!quizReady(questions)) return fail('Diagnostika testini tayyorlang va har savolda to‘g‘ri javobni belgilang.', 'newQuizFile');
    if (!youTubeEmbedUrl(video.trim())) return fail('To‘g‘ri YouTube havolasini kiriting.', 'newVideo');
    if (!presFile) return fail('Taqdimot faylini (.pptx) tanlang.', 'newPresFile');
    if (!docFile) return fail('Qo‘shimcha material faylini tanlang.', 'newDocFile');
    if (!task.trim()) return fail('Amaliy topshiriq matnini kiriting.', 'newTask');
    if (!refl.trim()) return fail('Refleksiya savollarini kiriting.', 'newRefl');
    return true;
  }

  async function saveSteps(moduleId: number): Promise<string[]> {
    const steps: [string, StepId, () => Promise<Record<string, unknown>>][] = [
      ['Diagnostika testi', 'diag', async () => ({ value: '', questions })],
      ['Video', 'video', async () => ({ value: video.trim() })],
      ['Taqdimot', 'pres', async () => ({ value: '', file_id: (await uploadFile(presFile!, { moduleId, stepType: 'pres', purpose: 'content' })).id })],
      ['Qo‘shimcha material', 'doc', async () => ({ value: docNote.trim(), file_id: (await uploadFile(docFile!, { moduleId, stepType: 'doc', purpose: 'content' })).id })],
      ['Topshiriq', 'task', async () => ({ value: task.trim(), file_id: taskFile ? (await uploadFile(taskFile, { moduleId, stepType: 'task', purpose: 'content' })).id : null })],
      ['Refleksiya', 'refl', async () => ({ value: refl.trim() })]
    ];
    const failed: string[] = [];
    for (const [label, stepType, build] of steps) {
      setStatus(`Saqlanmoqda: ${label}…`);
      try {
        await api('/content', 'POST', { module_id: moduleId, step_type: stepType, content: await build() });
      } catch (error) {
        failed.push(`${label} (${(error as Error).message})`);
      }
    }
    setStatus('');
    return failed;
  }

  async function save() {
    if (!order) return fail('Iltimos, tartib raqamini kiriting.', 'newModOrder');
    if (!title.trim()) return fail('Iltimos, modul nomini kiriting.', 'newModTitle');
    const creating = !editing;
    if (creating && !validateSteps()) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { order_num: Number(order), title: title.trim(), description: description.trim() };
      if (editing) payload.id = editing.id;
      const saved = await api<Module>('/modules', 'POST', payload);
      const failed = creating ? await saveSteps(saved.id) : [];
      if (failed.length) showToast(`Modul yaratildi, lekin saqlanmadi: ${failed.join('; ')}. Pastdan to‘ldiring.`, 'warning');
      else showToast(creating ? 'Modul barcha materiallari bilan yaratildi!' : 'Modul muvaffaqiyatli yangilandi!', 'success');
      await refreshModules();
      resetForm();
    } catch (error) {
      showToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(module: Module) {
    if (!window.confirm(`Haqiqatan ham "${module.title}" modulini o‘chirmoqchimisiz?\nModul talabalarga ko‘rinmay qoladi, keyin uni tiklash mumkin.`)) return;
    try {
      await api(`/modules?id=${module.id}`, 'DELETE');
      showToast('Modul o‘chirildi.', 'info');
      if (editId === module.id) resetForm();
      await Promise.all([refreshModules(), queryClient.invalidateQueries({ queryKey: keys.deletedModules })]);
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  }

  async function restore(id: number) {
    try {
      await api('/modules', 'POST', { action: 'restore', id });
      showToast('Modul tiklandi.', 'success');
      await Promise.all([refreshModules(), queryClient.invalidateQueries({ queryKey: keys.deletedModules })]);
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  }

  const openEditor = (moduleId: number, stepId: StepId) => useApp.setState({ contentModal: { moduleId, stepId } });

  return (
    <>
      <StaffModuleTabs active="manage-modules"/>
      <div className="card">
        <h3 className="card-title"><PencilLine/> {editing ? 'Modulni tahrirlash' : 'Yangi modul qo‘shish'}</h3>
        <div className="module-basics">
          <div className="form-group">
            <label htmlFor="newModOrder">Tartib №</label>
            <input type="number" id="newModOrder" min={1} value={order} onChange={(e) => setOrder(e.target.value)}/>
          </div>
          <div className="form-group">
            <label htmlFor="newModTitle">Modul nomi</label>
            <input type="text" id="newModTitle" maxLength={200} placeholder="Masalan: Ta'lim tamoyillari" value={title} onChange={(e) => setTitle(e.target.value)}/>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="newModDesc">Modul haqida qisqacha ta'rif</label>
          <input type="text" id="newModDesc" maxLength={5000} placeholder="Modul nimalarni o‘rgatadi…" value={description} onChange={(e) => setDescription(e.target.value)}/>
        </div>
        {!editing && (
          <div className="module-steps" key={formKey}>
            <fieldset className="module-step">
              <legend>1. Diagnostika testi</legend>
              <QuizBuilder prefix="new" questions={questions} onChange={setQuestions}/>
            </fieldset>
            <fieldset className="module-step">
              <legend>2. Video dars</legend>
              <div className="form-group">
                <label htmlFor="newVideo">YouTube havolasi</label>
                <input type="url" id="newVideo" placeholder="https://www.youtube.com/watch?v=…" value={video} onChange={(e) => setVideo(e.target.value)}/>
              </div>
            </fieldset>
            <fieldset className="module-step">
              <legend>3. Taqdimot</legend>
              <div className="form-group">
                <span className="form-label">PowerPoint fayli (.pptx)</span>
                <FilePicker id="newPresFile" accept=".pptx" file={presFile} onChange={setPresFile} hint="Faqat PowerPoint (.pptx), 30 MB gacha."/>
              </div>
            </fieldset>
            <fieldset className="module-step">
              <legend>4. Qo‘shimcha material</legend>
              <div className="form-group">
                <span className="form-label">Fayl</span>
                <FilePicker id="newDocFile" accept={DOCUMENT_ACCEPT} file={docFile} onChange={setDocFile} hint="PDF, Word, Excel, PowerPoint, matn yoki rasm, 30 MB gacha."/>
              </div>
              <div className="form-group">
                <label htmlFor="newDocNote">Qisqacha izoh (ixtiyoriy)</label>
                <textarea id="newDocNote" rows={2} maxLength={30000} value={docNote} onChange={(e) => setDocNote(e.target.value)}/>
              </div>
            </fieldset>
            <fieldset className="module-step">
              <legend>5. Amaliy topshiriq</legend>
              <div className="form-group">
                <label htmlFor="newTask">Topshiriq matni</label>
                <textarea id="newTask" rows={3} maxLength={30000} placeholder="Talaba bajarishi kerak bo‘lgan topshiriq…" value={task} onChange={(e) => setTask(e.target.value)}/>
              </div>
              <div className="form-group">
                <span className="form-label">Ilova fayl (ixtiyoriy)</span>
                <FilePicker id="newTaskFile" accept={DOCUMENT_ACCEPT} file={taskFile} onChange={setTaskFile}/>
              </div>
            </fieldset>
            <fieldset className="module-step">
              <legend>6. Refleksiya</legend>
              <div className="form-group">
                <label htmlFor="newRefl">Yo‘naltiruvchi savollar</label>
                <textarea id="newRefl" rows={3} maxLength={30000} placeholder="Modul yakunida talaba nimalar haqida yozsin?" value={refl} onChange={(e) => setRefl(e.target.value)}/>
              </div>
            </fieldset>
            <div id="moduleSaveStatus" className="field-hint" aria-live="polite">{status}</div>
          </div>
        )}
        <div className="mt-2.5 flex gap-2.5">
          <button type="button" className="btn-primary" id="saveModuleBtn" disabled={busy} onClick={save}>
            <Save/> {editing ? 'O‘zgarishlarni saqlash' : 'Modulni yaratish'}
          </button>
          {editing && <button type="button" className="btn-outline" onClick={resetForm}><X/> Bekor qilish</button>}
        </div>
      </div>

      <div className="card">
        <h3 className="card-title"><Layers/> Mavjud modullar va didaktik materiallar</h3>
        {!list.length && <p className="text-muted">Hozircha hech qanday modul yo‘q. Yuqoridagi shakl orqali modul qo‘shing.</p>}
        {list.map((module) => {
          const mine = canManage(user, module);
          return (
            <div key={module.id} className="mb-4 rounded-xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-2.5">
                <div>
                  <span className="badge badge-primary">№ {module.order_num}</span>
                  <strong className="ml-2 text-base">{module.title}</strong>
                  <p className="mt-1 text-sm text-muted">{module.description || ''}</p>
                </div>
                {mine ? (
                  <div className="flex gap-2">
                    <button type="button" className="btn-outline btn-sm" onClick={() => { useApp.setState({ editModuleId: module.id }); document.getElementById('pageContainer')?.scrollTo(0, 0); }}><Pencil/> Tahrirlash</button>
                    <button type="button" className="btn-danger" onClick={() => remove(module)}><Trash2/> O‘chirish</button>
                  </div>
                ) : (
                  <span className="badge badge-muted"><Lock/> Boshqa o‘qituvchining moduli</span>
                )}
              </div>
              {mine && (
                <div className="mt-4 border-t border-dashed border-line pt-4">
                  <div className="mb-2 text-sm text-muted">6 ta qadam materiallarini biriktirish:</div>
                  <div className="flex flex-wrap gap-2">
                    {STEP_BUTTONS.map((step) => (
                      <button key={step.id} type="button" className="btn-outline btn-sm" onClick={() => openEditor(module.id, step.id)}>{step.icon} {step.label}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div id="deletedModules">
        {Boolean(deleted.data?.length) && (
          <div className="card">
            <h3 className="card-title"><Archive/> O‘chirilgan modullar</h3>
            <ul className="plain-list">
              {deleted.data!.map((module) => (
                <li key={module.id} className="deleted-module">
                  <span>№ {Number(module.order_num)}. {module.title}</span>
                  <button type="button" className="btn-outline" onClick={() => restore(module.id)}><RotateCcw/> Tiklash</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
