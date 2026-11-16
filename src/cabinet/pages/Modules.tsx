import { ArrowLeft, ArrowRight, CircleCheck, CirclePlay, Eye, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { CoverPicker } from '../../components/CoverPicker';
import { PageSkeleton } from '../../components/Skeleton';
import { api } from '../../lib/api';
import { imageUrl } from '../../lib/learning';
import { prefetchModule } from '../../lib/prefetch';
import { refreshModules, useModules, useMyProgress, useSubjects } from '../../lib/queries';
import { canManage } from '../../lib/steps';
import { navigate, openModule, openSubject, showToast, startModule, useApp } from '../../store';
import type { Module, Progress, Subject } from '../../types';

export function StaffModuleTabs({ active }: { active: 'modules' | 'manage-modules' }) {
  const role = useApp((state) => state.user?.role);
  if (role === 'student') return null;
  return (
    <div className="segmented mb-5" role="group" aria-label="Fanlar va modullar bo‘limi">
      <button type="button" aria-pressed={active === 'modules'} onClick={() => navigate('modules')}>Fanlar va modullar</button>
      <button type="button" id="tabManage" aria-pressed={active === 'manage-modules'} onClick={() => navigate('manage-modules')}>Yaratish va tahrirlash</button>
    </div>
  );
}

const isFinished = (progress: Progress | undefined) => (progress?.completed_steps.length ?? 0) >= 6;

// Two letters for a subject without a cover: “Ta’lim nazariyasi” → “TN”.
export function subjectInitials(title: string) {
  const [first = '', second = ''] = title.split(/\s+/).filter(Boolean);
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
}

function SubjectForm({ subject, onDone }: { subject?: Subject; onDone: (saved?: Subject) => void }) {
  const [title, setTitleText] = useState(subject?.title ?? '');
  const [description, setDescription] = useState(subject?.description ?? '');
  const [cover, setCover] = useState<string | null>(subject?.cover_image_id ?? null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (title.trim().length < 2) {
      showToast('Fan nomini kiriting (kamida 2 belgi).', 'warning');
      document.getElementById('subjectTitle')?.focus();
      return;
    }
    setBusy(true);
    try {
      const saved = await api<Subject>('/subjects', 'POST', {
        ...(subject ? { id: subject.id } : {}), title: title.trim(), description: description.trim(), cover_image_id: cover
      });
      await refreshModules();
      showToast(subject ? 'Fan yangilandi.' : 'Fan qo‘shildi.', 'success');
      onDone(saved);
    } catch (error) {
      showToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id="subjectForm" className="card" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h3 className="card-title">{subject ? 'Fanni tahrirlash' : 'Yangi fan qo‘shish'}</h3>
      <div className="form-group">
        <label htmlFor="subjectTitle">Fan nomi</label>
        <input type="text" id="subjectTitle" maxLength={200} placeholder="Masalan: Neyropedagogika" value={title} onChange={(e) => setTitleText(e.target.value)} autoFocus/>
      </div>
      <div className="form-group">
        <label htmlFor="subjectDesc">Qisqacha ta’rif <span className="text-muted">(ixtiyoriy)</span></label>
        <textarea id="subjectDesc" rows={2} maxLength={2000} placeholder="Fan nimani o‘rgatadi…" value={description} onChange={(e) => setDescription(e.target.value)}/>
      </div>
      <div className="form-group">
        <span className="form-label">Muqova rasmi <span className="text-muted">(ixtiyoriy)</span></span>
        <CoverPicker value={cover} onChange={setCover}/>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2.5">
        <button type="submit" className="btn-primary" id="saveSubjectBtn" disabled={busy}><Save/> {subject ? 'Saqlash' : 'Fanni qo‘shish'}</button>
        <button type="button" className="btn-outline" onClick={() => onDone()}><X/> Bekor qilish</button>
      </div>
    </form>
  );
}

function SubjectCard({ subject, modules, progress, isStudent }: { subject: Subject; modules: Module[]; progress?: Record<number, Progress>; isStudent: boolean }) {
  const finished = modules.filter((module) => isFinished(progress?.[module.id])).length;
  const pct = modules.length ? Math.round((finished / modules.length) * 100) : 0;
  return (
    <button type="button" className="subject-card" data-subject={subject.id} onClick={() => openSubject(subject.id)}>
      {subject.cover_image_id
        ? <img src={imageUrl(subject.cover_image_id)!} alt="" loading="lazy" className="subject-cover"/>
        : <span className="subject-mark" aria-hidden="true">{subjectInitials(subject.title)}</span>}
      <div className="flex flex-1 flex-col p-5">
        <span className="text-sm font-medium text-primary">{modules.length} ta modul</span>
        <h3 className="mt-1 text-lg font-semibold text-ink">{subject.title}</h3>
        {subject.description && <p className="mt-1 line-clamp-3 text-sm text-muted">{subject.description}</p>}
        <div className="flex-1"/>
        {isStudent && modules.length > 0 ? (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-sm text-muted"><span>{finished}/{modules.length} modul tamomlandi</span><span>{pct}%</span></div>
            <div className="progress-bar-track m-0"><div className={`progress-bar-fill${pct === 100 ? ' complete' : ''}`} style={{ width: `${pct}%` }}/></div>
          </div>
        ) : (
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">Modullarni ko‘rish <ArrowRight className="size-4"/></span>
        )}
      </div>
    </button>
  );
}

// The first level: every subject, and for staff a tile that adds another.
export function Modules() {
  const user = useApp((state) => state.user);
  const isStudent = user?.role === 'student';
  const subjects = useSubjects();
  const modules = useModules();
  const progress = useMyProgress();
  const [adding, setAdding] = useState(false);

  if (subjects.isLoading || modules.isLoading) return <><StaffModuleTabs active="modules"/><PageSkeleton/></>;
  const list = subjects.data ?? [];
  const byId = (id: number) => (modules.data ?? []).filter((module) => module.subject_id === id);

  return (
    <>
      <StaffModuleTabs active="modules"/>
      {adding && <SubjectForm onDone={(saved) => { setAdding(false); if (saved) openSubject(saved.id); }}/>}
      {!list.length && isStudent && <div className="card"><p>Hozircha fanlar qo‘shilmagan.</p></div>}
      <div className="subjects-grid" id="subjectList">
        {list.map((subject) => (
          <SubjectCard key={subject.id} subject={subject} modules={byId(subject.id)} progress={progress.data} isStudent={isStudent}/>
        ))}
        {!isStudent && !adding && (
          <button type="button" className="subject-add" id="addSubjectBtn" onClick={() => setAdding(true)}>
            <Plus className="size-8 text-primary"/>
            <span className="text-lg font-semibold text-ink">Fan qo‘shish</span>
            <span className="text-sm text-muted">Yangi fan ochib, unga modullar qo‘shing</span>
          </button>
        )}
      </div>
    </>
  );
}

function ModuleCard({ module, progress, isStudent }: { module: Module; progress?: Progress; isStudent: boolean }) {
  const steps = progress?.completed_steps.length ?? 0;
  const done = steps >= 6;
  const pct = Math.round((steps / 6) * 100);
  const StatusIcon = done ? CircleCheck : isStudent ? CirclePlay : Eye;
  return (
    <button type="button" className="module-card text-left" onPointerEnter={() => prefetchModule(module.id)} onFocus={() => prefetchModule(module.id)} onClick={() => openModule(module.id)}>
      {module.cover_image_id && <img src={imageUrl(module.cover_image_id)!} alt="" loading="lazy" className="module-cover"/>}
      <div className="mod-info flex-1 pr-5">
        <div className="mb-1 text-sm text-primary">Modul {module.order_num}</div>
        <h4>{module.title}</h4>
        <p>{module.description || ''}</p>
        {isStudent ? (
          <div className="mt-3 max-w-80">
            <div className="mb-1 flex justify-between text-sm text-muted"><span>{steps}/6 qadam bajarildi</span><span>{pct}%</span></div>
            <div className="progress-bar-track m-0"><div className={`progress-bar-fill${done ? ' complete' : ''}`} style={{ width: `${pct}%` }}/></div>
          </div>
        ) : (
          <p className="mt-2 text-sm font-medium text-primary">Materiallar va bosqichlarni ko‘rish &rarr;</p>
        )}
      </div>
      <div className={`mod-status${done ? ' done' : ''}`}><StatusIcon/></div>
    </button>
  );
}

// The second level: one subject and its modules.
export function SubjectModules({ subjectId }: { subjectId: number | null }) {
  const user = useApp((state) => state.user);
  const isStudent = user?.role === 'student';
  const subjects = useSubjects();
  const modules = useModules();
  const progress = useMyProgress();
  const [editing, setEditing] = useState(false);
  const subject = subjects.data?.find((item) => item.id === Number(subjectId));

  if (subjects.isLoading || modules.isLoading) return <PageSkeleton/>;
  if (!subject) {
    return (
      <div className="card">
        <p>Bu fan topilmadi yoki o‘chirilgan.</p>
        <button type="button" className="btn-outline mt-4" onClick={() => navigate('modules')}><ArrowLeft/> Barcha fanlar</button>
      </div>
    );
  }

  const list = (modules.data ?? []).filter((module) => module.subject_id === subject.id);
  const mine = canManage(user, subject);

  async function remove() {
    if (!window.confirm(`“${subject!.title}” fanini o‘chirmoqchimisiz?`)) return;
    try {
      await api(`/subjects?id=${subject!.id}`, 'DELETE');
      await refreshModules();
      showToast('Fan o‘chirildi.', 'info');
      navigate('modules');
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  }

  return (
    <>
      <button type="button" className="back-btn" id="backToSubjects" onClick={() => navigate('modules')}><ArrowLeft/> Barcha fanlar</button>
      {editing ? <SubjectForm subject={subject} onDone={() => setEditing(false)}/> : (
        <div className="card flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <span className="text-sm font-medium text-primary">Fan · {list.length} ta modul</span>
            <h2 id="subjectHeading" className="mt-1 text-2xl font-bold tracking-tight text-ink">{subject.title}</h2>
            {subject.description && <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{subject.description}</p>}
          </div>
          {!isStudent && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" className="btn-primary" id="addModuleToSubject" onClick={() => startModule(subject.id)}><Plus/> Modul qo‘shish</button>
              {mine && <button type="button" className="btn-outline" id="editSubjectBtn" onClick={() => setEditing(true)}><Pencil/> Tahrirlash</button>}
              {mine && <button type="button" className="btn-danger" id="deleteSubjectBtn" onClick={remove}><Trash2/> O‘chirish</button>}
            </div>
          )}
        </div>
      )}
      {!list.length && <div className="card"><p className="text-muted">Bu fanda hozircha modullar yo‘q.{!isStudent && ' “Modul qo‘shish” tugmasi orqali birinchisini yarating.'}</p></div>}
      <div className="modules-grid" id="subjectModules">
        {list.map((module) => <ModuleCard key={module.id} module={module} progress={progress.data?.[module.id]} isStudent={isStudent}/>)}
      </div>
    </>
  );
}
