import { useQuery } from '@tanstack/react-query';
import { Award, BookOpen, CircleCheck, FolderPen, GraduationCap, UserCheck, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { useModules, useMyProgress } from '../../lib/queries';
import { openUsers, useApp } from '../../store';
import type { UsersPage } from '../../types';

function Stat({ icon, value, label, id, onClick }: { icon: ReactNode; value: ReactNode; label: string; id?: string; onClick?: () => void }) {
  const inner = (
    <>
      <div className="stat-icon">{icon}</div>
      <div className="stat-info"><h3 id={id} className="tabular-nums">{value}</h3><p>{label}</p></div>
    </>
  );
  return onClick
    ? <button type="button" className="stat-card text-left transition-colors duration-200 hover:border-primary" onClick={onClick}>{inner}</button>
    : <div className="stat-card">{inner}</div>;
}

export function Dashboard() {
  const user = useApp((state) => state.user)!;
  const modules = useModules();
  const progress = useMyProgress();
  const counts = useQuery({
    queryKey: ['users', 'counts'],
    enabled: user.role === 'admin',
    queryFn: () => api<UsersPage>('/users?page_size=1')
  });
  const list = modules.data ?? [];
  const rows = Object.values(progress.data ?? {});
  const count = (key: 'student' | 'teacher' | 'pending') => (counts.data ? String(counts.data.counts[key] ?? 0) : counts.isError ? '—' : '…');

  let cards: ReactNode;
  if (user.role === 'student') {
    cards = (
      <>
        <Stat icon={<BookOpen/>} value={list.length} label="Jami modullar"/>
        <Stat icon={<CircleCheck/>} value={rows.filter((row) => row.completed_steps.length >= 6).length} label="Tugatilgan modullar"/>
        <Stat icon={<Award/>} value={`${rows.reduce((sum, row) => sum + (Number(row.total_score) || 0), 0)} ball`} label="To‘plangan ballar"/>
      </>
    );
  } else if (user.role === 'admin') {
    cards = (
      <>
        <Stat icon={<BookOpen/>} value={list.length} label="Mavjud modullar"/>
        <Stat icon={<Users/>} id="adminStudentCount" value={count('student')} label="Ro‘yxatdan o‘tgan talabalar" onClick={() => openUsers('student')}/>
        <Stat icon={<GraduationCap/>} id="adminTeacherCount" value={count('teacher')} label="Ro‘yxatdan o‘tgan o‘qituvchilar" onClick={() => openUsers('teacher')}/>
        <Stat icon={<UserCheck/>} id="adminPendingCount" value={count('pending')} label="Tasdiq kutayotgan o‘qituvchilar" onClick={() => openUsers('pending')}/>
      </>
    );
  } else {
    cards = (
      <>
        <Stat icon={<BookOpen/>} value={list.length} label="Mavjud modullar"/>
        <Stat icon={<FolderPen/>} value={list.filter((module) => Number(module.created_by) === Number(user.id)).length} label="Siz yaratgan modullar"/>
        <Stat icon={<GraduationCap/>} value="O‘qituvchi" label="Sizning maqomingiz"/>
      </>
    );
  }

  return (
    <>
      <div className="dashboard-grid">{cards}</div>
      <div className="card">
        <h3 className="card-title">Xush kelibsiz, {user.name || user.login}!</h3>
        <p className="leading-[1.8] text-muted">
          Platformada zamonaviy ta'lim nazariyalari, 6 qadamli didaktik modullar hamda talabalar monitoringi va interaktiv vizualizatsiyasi jamlangan.{' '}
          {user.role === 'student'
            ? "Chap menyudan 'Modullar' bo‘limiga o‘tib bilimlaringizni oshiring."
            : "Siz o‘z modullaringizni boshqarishingiz, materiallar kiritishingiz, 'Tahlil va grafika' bo‘limida o‘quvchilar natijalarini tahlil qilishingiz mumkin."}
        </p>
      </div>
    </>
  );
}
