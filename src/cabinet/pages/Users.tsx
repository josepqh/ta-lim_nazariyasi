import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ROLE_LABELS, formatDate } from '../../lib/format';
import { queryClient, useModules } from '../../lib/queries';
import { navigate, setTitle, showToast, useApp, type UsersTab } from '../../store';
import type { ErrorLogEntry, Progress, UserProfile as Profile, UsersPage as UsersData } from '../../types';
import { StudentWork } from './Submissions';

function StatusBadge({ status }: { status: string | null }) {
  const value = status || 'active';
  if (value === 'active') return <span className="badge badge-success">Faol</span>;
  if (value === 'pending') return <span className="badge badge-primary">Tasdiq kutmoqda</span>;
  return <span className="badge badge-muted">Bloklangan</span>;
}

export function UsersPage() {
  const tab = useApp((state) => state.usersTab);
  const query = useApp((state) => state.usersQuery);
  const page = useApp((state) => state.usersPage);
  const [search, setSearch] = useState(query);

  // Typing settles for a moment before the list is asked for again.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() !== query) useApp.setState({ usersQuery: search.trim(), usersPage: 1 });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query]);

  const params = new URLSearchParams({ page: String(page) });
  if (tab === 'pending') params.set('status', 'pending');
  else params.set('role', tab);
  if (query) params.set('q', query);
  const data = useQuery({
    queryKey: ['users', tab, query, page],
    queryFn: () => api<UsersData>(`/users?${params}`),
    placeholderData: keepPreviousData
  });

  const setTab = (next: UsersTab) => useApp.setState({ usersTab: next, usersPage: 1 });
  const counts = data.data?.counts;

  async function decide(id: number, action: 'approve' | 'reject', name: string) {
    if (action === 'reject' && !window.confirm(`${name} so‘rovini rad etasizmi? Hisob o‘chiriladi, u keyin qayta ariza berishi mumkin.`)) return;
    try {
      await api('/users', 'POST', { action, id });
      showToast(action === 'approve' ? `${name} o‘qituvchi sifatida tasdiqlandi.` : `${name} so‘rovi rad etildi.`, action === 'approve' ? 'success' : 'info');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  }

  const items = data.data?.items ?? [];
  const totalPages = data.data ? Math.max(1, Math.ceil(data.data.total / data.data.page_size)) : 1;
  const emptyLabel = tab === 'student' ? 'talabalar' : tab === 'teacher' ? 'o‘qituvchilar' : null;

  return (
    <div className="card">
      <div className="users-toolbar">
        <div className="segmented" role="group" aria-label="Rol bo‘yicha filtr">
          <button type="button" id="usersTabStudent" aria-pressed={tab === 'student'} onClick={() => setTab('student')}>Talabalar{counts ? ` (${counts.student ?? 0})` : ''}</button>
          <button type="button" id="usersTabTeacher" aria-pressed={tab === 'teacher'} onClick={() => setTab('teacher')}>O‘qituvchilar{counts ? ` (${counts.teacher ?? 0})` : ''}</button>
          <button type="button" id="usersTabPending" aria-pressed={tab === 'pending'} onClick={() => setTab('pending')}>Tasdiq kutayotganlar{counts ? ` (${counts.pending ?? 0})` : ''}</button>
        </div>
        <div className="users-search">
          <label htmlFor="usersSearch" className="visually-hidden">Ism yoki login bo‘yicha qidirish</label>
          <input id="usersSearch" type="search" placeholder="Ism yoki login bo‘yicha qidirish..." value={search} onChange={(e) => setSearch(e.target.value)}/>
        </div>
      </div>
      <div id="usersTable" aria-live="polite">
        {data.isLoading && <div className="spinner"/>}
        {data.isError && <p className="muted-text">Ma'lumotlarni yuklab bo‘lmadi.</p>}
        {data.isSuccess && !items.length && (
          <p className="muted-text empty-text">
            {query ? 'Qidiruv bo‘yicha hech kim topilmadi.' : emptyLabel ? `Hozircha ro‘yxatdan o‘tgan ${emptyLabel} yo‘q.` : 'Tasdiq kutayotgan o‘qituvchi yo‘q.'}
          </p>
        )}
        {items.length > 0 && (
          <div className="min-w-0">
            <table className="leaderboard-table">
              <thead><tr>
                <th className="col-left">F.I.Sh</th><th className="col-left">Login</th>
                {tab === 'student' && <><th>Tugatilgan modullar</th><th>Ball</th></>}
                {tab === 'teacher' && <th>Yaratgan modullari</th>}
                <th>Ro‘yxatdan o‘tgan</th><th>{tab === 'pending' ? 'Qaror' : 'Holat'}</th>
              </tr></thead>
              <tbody>
                {items.map((user) => (
                  <tr key={user.id}>
                    <td data-label="F.I.Sh" className="col-left">
                      {tab === 'pending' ? <strong>{user.name || user.login}</strong>
                        : <button type="button" className="link-btn" onClick={() => navigate('user-profile', user.id)}>{user.name || user.login}</button>}
                    </td>
                    <td data-label="Login" className="col-left">{user.login}</td>
                    {tab === 'student' && <><td data-label="Modullar">{Number(user.modules_finished)} / {Number(user.modules_started)}</td><td data-label="Ball">{Number(user.total_score)}</td></>}
                    {tab === 'teacher' && <td data-label="Modullar">{Number(user.modules_created)}</td>}
                    <td data-label="Sana">{formatDate(user.created_at)}</td>
                    <td data-label={tab === 'pending' ? 'Qaror' : 'Holat'}>
                      {tab === 'pending' ? (
                        <span className="inline-flex flex-wrap justify-end gap-2">
                          <button type="button" className="btn-primary btn-sm" onClick={() => decide(user.id, 'approve', user.name || user.login)}><Check/> Tasdiqlash</button>
                          <button type="button" className="btn-danger btn-sm" onClick={() => decide(user.id, 'reject', user.name || user.login)}><X/> Rad etish</button>
                        </span>
                      ) : <StatusBadge status={user.status}/>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && data.data && (
          <div className="pagination">
            <button type="button" className="btn-outline" disabled={data.data.page <= 1} onClick={() => useApp.setState({ usersPage: data.data!.page - 1 })}>Oldingi</button>
            <span>{data.data.page} / {totalPages}</span>
            <button type="button" className="btn-outline" disabled={data.data.page >= totalPages} onClick={() => useApp.setState({ usersPage: data.data!.page + 1 })}>Keyingi</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function UserProfile({ profileId }: { profileId: number | null }) {
  const modules = useModules();
  const profile = useQuery({
    queryKey: ['users', 'profile', profileId],
    enabled: Boolean(profileId),
    queryFn: () => api<Profile>(`/users?id=${profileId}`)
  });
  const isStudent = profile.data?.role === 'student';
  const work = useQuery({
    queryKey: ['progress', `student:${profileId}`],
    enabled: Boolean(profileId) && isStudent,
    queryFn: () => api<Progress[]>(`/progress?user_id=${profileId}`)
  });
  useEffect(() => {
    if (profile.data) {
      setTitle(profile.data.name || profile.data.login);
      useApp.setState({ usersTab: profile.data.role === 'teacher' ? 'teacher' : 'student' });
    }
  }, [profile.data]);

  if (profile.isLoading) return <div className="spinner"/>;
  if (!profile.data) return <div className="card">Foydalanuvchi topilmadi.</div>;
  const data = profile.data;
  return (
    <>
      <button type="button" className="back-btn" onClick={() => navigate('users')}><ArrowLeft/> Foydalanuvchilar ro‘yxatiga qaytish</button>
      <div className="card">
        <h3 className="card-title">{data.name || data.login}</h3>
        <dl className="profile-grid">
          <div><dt>Login</dt><dd>{data.login}</dd></div>
          <div><dt>Rol</dt><dd>{ROLE_LABELS[data.role] || data.role}</dd></div>
          <div><dt>Holat</dt><dd><StatusBadge status={data.status}/></dd></div>
          <div><dt>Ro‘yxatdan o‘tgan</dt><dd>{formatDate(data.created_at)}</dd></div>
          <div><dt>Oxirgi kirish</dt><dd>{formatDate(data.last_login_at)}</dd></div>
        </dl>
      </div>
      {isStudent ? (
        work.isError ? <div className="card">Natijalarni yuklab bo‘lmadi.</div>
          : work.isLoading ? <div className="spinner"/> : <StudentWork rows={work.data ?? []} modules={modules.data ?? []}/>
      ) : (
        <div className="card">
          <h3 className="card-title">Yaratgan modullari</h3>
          {data.modules_created.length
            ? <ul className="plain-list">{data.modules_created.map((module) => <li key={module.id}>Modul {Number(module.order_num)}. {module.title}</li>)}</ul>
            : <p className="muted-text">Hozircha modul yaratmagan.</p>}
        </div>
      )}
    </>
  );
}

interface ErrorPage {
  items: ErrorLogEntry[];
  total: number;
  last_day: number;
  page: number;
  page_size: number;
}

// What broke on the server or in visitors' browsers in the last 30 days.
export function ErrorLog() {
  const [page, setPage] = useState(1);
  const log = useQuery({ queryKey: ['errors', page], queryFn: () => api<ErrorPage>(`/errors?page=${page}`), placeholderData: keepPreviousData });

  async function clear() {
    if (!window.confirm('Jurnaldagi barcha yozuvlar o‘chirilsinmi?')) return;
    try {
      await api('/errors', 'DELETE');
      showToast('Xatolar jurnali tozalandi.', 'info');
      setPage(1);
      await queryClient.invalidateQueries({ queryKey: ['errors'] });
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  }

  const data = log.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <>
      <div className="dashboard-grid">
        <div className="stat-card"><div className="stat-info"><h3 id="errorsLastDay" className="tabular-nums">{data?.last_day ?? '…'}</h3><p>Oxirgi 24 soatda</p></div></div>
        <div className="stat-card"><div className="stat-info"><h3 className="tabular-nums">{data?.total ?? '…'}</h3><p>Jami yozuvlar (30 kun)</p></div></div>
      </div>
      <div className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="card-title m-0">Server va brauzer xatolari</h3>
          <div className="flex gap-2">
            <button type="button" className="btn-outline btn-sm" onClick={() => log.refetch()}><RefreshCw/> Yangilash</button>
            <button type="button" className="btn-danger btn-sm" disabled={!data?.total} onClick={clear}><Trash2/> Tozalash</button>
          </div>
        </div>
        {log.isLoading && <div className="spinner"/>}
        {log.isError && <p className="muted-text">Jurnalni yuklab bo‘lmadi.</p>}
        {data && !data.items.length && <p className="muted-text empty-text">Xato qayd etilmagan.</p>}
        <ul className="error-list">
          {data?.items.map((entry) => (
            <li key={entry.id} className="error-entry">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <span className={`badge ${entry.source === 'server' ? 'badge-danger' : 'badge-primary'}`}>{entry.source === 'server' ? 'Server' : 'Brauzer'}</span>
                <time>{formatDate(entry.created_at)}</time>
                {entry.path && <code className="wrap-anywhere">{entry.path}</code>}
                {entry.user_name && <span>· {entry.user_name}</span>}
              </div>
              <p className="mt-1.5 font-medium wrap-anywhere text-ink">{entry.message}</p>
              {(entry.detail || entry.user_agent) && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-sm text-muted">Tafsilotlar</summary>
                  {entry.detail && <pre className="error-detail">{entry.detail}</pre>}
                  {entry.user_agent && <p className="mt-1 text-xs wrap-anywhere text-muted">{entry.user_agent}</p>}
                </details>
              )}
            </li>
          ))}
        </ul>
        {totalPages > 1 && data && (
          <div className="pagination">
            <button type="button" className="btn-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Oldingi</button>
            <span>{page} / {totalPages}</span>
            <button type="button" className="btn-outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Keyingi</button>
          </div>
        )}
      </div>
    </>
  );
}
