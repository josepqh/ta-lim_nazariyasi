import { CircleCheck, CirclePlay, Eye } from 'lucide-react';
import { useModules, useMyProgress } from '../../lib/queries';
import { navigate, openModule, useApp } from '../../store';

export function StaffModuleTabs({ active }: { active: 'modules' | 'manage-modules' }) {
  const role = useApp((state) => state.user?.role);
  if (role === 'student') return null;
  return (
    <div className="segmented mb-5" role="group" aria-label="Modullar bo‘limi">
      <button type="button" aria-pressed={active === 'modules'} onClick={() => navigate('modules')}>Barcha modullar</button>
      <button type="button" id="tabManage" aria-pressed={active === 'manage-modules'} onClick={() => navigate('manage-modules')}>Yaratish va tahrirlash</button>
    </div>
  );
}

export function Modules() {
  const isStudent = useApp((state) => state.user?.role === 'student');
  const modules = useModules();
  const progress = useMyProgress();
  const list = modules.data ?? [];

  if (modules.isLoading) return <><StaffModuleTabs active="modules"/><div className="spinner"/></>;
  if (!list.length) return <><StaffModuleTabs active="modules"/><div className="card"><p>Hozircha modullar mavjud emas.</p></div></>;

  return (
    <>
      <StaffModuleTabs active="modules"/>
      <div className="modules-grid">
        {list.map((module) => {
          const steps = progress.data?.[module.id]?.completed_steps.length ?? 0;
          const done = steps >= 6;
          const pct = Math.round((steps / 6) * 100);
          const StatusIcon = done ? CircleCheck : isStudent ? CirclePlay : Eye;
          return (
            <button key={module.id} type="button" className="module-card text-left" onClick={() => openModule(module.id)}>
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
        })}
      </div>
    </>
  );
}
