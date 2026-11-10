import { useQuery } from '@tanstack/react-query';
import { KeyRound, Save } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { PageSkeleton } from '../../components/Skeleton';
import { api } from '../../lib/api';
import { ROLE_LABELS, formatDate, initialOf } from '../../lib/format';
import { useMyProgress } from '../../lib/queries';
import { showToast, useApp } from '../../store';
import type { Role } from '../../types';

interface Profile {
  name: string | null;
  login: string;
  role: Role;
  created_at: string | null;
  last_login_at: string | null;
}

export function MyProfile() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/profile') });
  const progress = useMyProgress();
  const [name, setName] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [nameError, setNameError] = useState('');
  const [passError, setPassError] = useState('');
  const [busy, setBusy] = useState<'name' | 'pass' | null>(null);

  if (profile.isLoading) return <PageSkeleton/>;
  if (!profile.data) return <div className="card">Profilni yuklab bo‘lmadi.</div>;
  const data = profile.data;
  const rows = Object.values(progress.data ?? {});
  const finished = rows.filter((row) => row.completed_steps.length >= 6).length;
  const score = rows.reduce((sum, row) => sum + (Number(row.total_score) || 0), 0);
  const nameValue = name ?? data.name ?? '';

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setNameError('');
    setBusy('name');
    try {
      const updated = await api<{ name: string }>('/profile', 'PATCH', { name: nameValue.trim() });
      useApp.setState((state) => ({ user: state.user ? { ...state.user, name: updated.name } : state.user }));
      await profile.refetch();
      setName(null);
      showToast('Ism saqlandi', 'success');
    } catch (error) {
      setNameError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setPassError('');
    setBusy('pass');
    try {
      await api('/profile', 'POST', { current_password: current, new_password: next });
      setCurrent('');
      setNext('');
      showToast('Parol yangilandi', 'success');
    } catch (error) {
      setPassError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="card">
        <div className="profile-head">
          <div className="profile-avatar" aria-hidden="true">{initialOf(data.name || data.login)}</div>
          <div>
            <h3 id="profileName">{data.name || data.login}</h3>
            <p className="muted-text">{ROLE_LABELS[data.role] || data.role}</p>
          </div>
        </div>
        <dl className="profile-grid">
          <div><dt>Gmail</dt><dd>{data.login}</dd></div>
          <div><dt>Ro‘yxatdan o‘tgan</dt><dd>{formatDate(data.created_at)}</dd></div>
          <div><dt>Oxirgi kirish</dt><dd>{formatDate(data.last_login_at)}</dd></div>
          {data.role === 'student' && (
            <>
              <div><dt>Tugatilgan modullar</dt><dd>{finished} ta</dd></div>
              <div><dt>To‘plangan ball</dt><dd>{score} ball</dd></div>
            </>
          )}
        </dl>
      </div>
      <div className="card">
        <h3 className="card-title">Ismni o‘zgartirish</h3>
        <form className="profile-form" onSubmit={saveName}>
          <div className="form-group">
            <label htmlFor="profileNameInput">F.I.Sh</label>
            <input id="profileNameInput" type="text" minLength={2} maxLength={100} autoComplete="name" required value={nameValue} onChange={(e) => setName(e.target.value)}/>
          </div>
          <div id="profileNameError" className="profile-error" role="alert">{nameError}</div>
          <button type="submit" className="btn-primary" disabled={busy === 'name'}><Save/> Saqlash</button>
        </form>
      </div>
      <div className="card">
        <h3 className="card-title">Parolni almashtirish</h3>
        <form className="profile-form" onSubmit={savePassword}>
          <div className="form-group">
            <label htmlFor="profileCurrentPass">Joriy parol</label>
            <input id="profileCurrentPass" type="password" maxLength={200} autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)}/>
          </div>
          <div className="form-group">
            <label htmlFor="profileNewPass">Yangi parol</label>
            <input id="profileNewPass" type="password" minLength={10} maxLength={200} autoComplete="new-password" placeholder="Kamida 10 belgi" required value={next} onChange={(e) => setNext(e.target.value)}/>
          </div>
          <div id="profilePassError" className="profile-error" role="alert">{passError}</div>
          <button type="submit" className="btn-primary" disabled={busy === 'pass'}><KeyRound/> Parolni yangilash</button>
        </form>
      </div>
    </>
  );
}
