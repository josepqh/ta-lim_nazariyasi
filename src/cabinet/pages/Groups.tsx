import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Plus, RefreshCw, Trash2, UserMinus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ListSkeleton, PageSkeleton } from '../../components/Skeleton';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useGroups } from '../../lib/learning';
import { navigate, showToast, useApp } from '../../store';
import type { GroupDetail } from '../../types';

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message, 'success');
  } catch {
    showToast(text, 'info');
  }
}

function GroupView({ id, onBack }: { id: number; onBack: () => void }) {
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ['groups', id], queryFn: () => api<GroupDetail>(`/groups?id=${id}`) });
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ['groups'] })]);

  async function act(run: () => Promise<unknown>, message: string) {
    try {
      await run();
      showToast(message, 'success');
      await refresh();
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  }

  if (detail.isLoading) return <PageSkeleton/>;
  if (!detail.data) return <div className="card">Guruh topilmadi.</div>;
  const group = detail.data;
  return (
    <>
      <button type="button" className="back-btn" onClick={onBack}><ArrowLeft/> Guruhlar ro‘yxatiga qaytish</button>
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="card-title mb-1">{group.name}</h3>
            <p className="text-sm text-muted">{group.members.length} ta talaba</p>
          </div>
          <div className="group-code" aria-label="Taklif kodi">
            <span className="text-xs font-semibold tracking-wide text-muted uppercase">Taklif kodi</span>
            <strong id="groupCodeValue">{group.code}</strong>
            <span className="flex gap-1.5">
              <button type="button" className="btn-outline btn-sm" onClick={() => copy(group.code!, 'Kod nusxalandi.')}><Copy/> Nusxalash</button>
              <button type="button" className="btn-outline btn-sm" onClick={() => act(() => api('/groups', 'POST', { action: 'new_code', id }), 'Yangi kod yaratildi; eski kod endi ishlamaydi.')}><RefreshCw/> Yangi kod</button>
            </span>
          </div>
        </div>
        <p className="mt-4 rounded-xl bg-primary/10 px-4 py-3 text-sm text-ink">Talabalar kabinetdagi “Guruhlarim” bo‘limida shu kodni kiritib qo‘shiladi. Tahlil va javoblar sahifalarida natijalarni shu guruh bo‘yicha saralash mumkin.</p>
      </div>
      <div className="card">
        <h3 className="card-title"><Users/> Guruh a’zolari</h3>
        {!group.members.length ? <p className="muted-text empty-text">Hali hech kim qo‘shilmagan. Kodni talabalarga yuboring.</p> : (
          <div className="min-w-0">
            <table className="leaderboard-table">
              <thead><tr><th className="col-left">F.I.Sh</th><th className="col-left">Login</th><th>Tugatgan modullar</th><th>Ball</th><th>Qo‘shilgan</th><th>Amal</th></tr></thead>
              <tbody>
                {group.members.map((member) => (
                  <tr key={member.id}>
                    <td data-label="F.I.Sh" className="col-left"><button type="button" className="link-btn" onClick={() => navigate('student-detail', member.id)}>{member.name || member.login}</button></td>
                    <td data-label="Login" className="col-left">{member.login}</td>
                    <td data-label="Modullar">{member.modules_finished}</td>
                    <td data-label="Ball">{member.total_score}</td>
                    <td data-label="Qo‘shilgan">{formatDate(member.joined_at)}</td>
                    <td data-label="Amal">
                      <button type="button" className="btn-outline btn-sm" onClick={() => {
                        if (window.confirm(`${member.name || member.login} guruhdan chiqarilsinmi?`)) {
                          void act(() => api('/groups', 'POST', { action: 'remove_member', id, user_id: member.id }), 'Talaba guruhdan chiqarildi.');
                        }
                      }}><UserMinus/> Chiqarish</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card border-danger/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] text-muted">Guruhni o‘chirish talabalarning natijalariga ta’sir qilmaydi, faqat guruh va uning kodi yo‘qoladi.</p>
          <button type="button" className="btn-danger" onClick={() => {
            if (!window.confirm(`“${group.name}” guruhi o‘chirilsinmi?`)) return;
            void act(() => api(`/groups?id=${id}`, 'DELETE'), 'Guruh o‘chirildi.').then(onBack);
          }}><Trash2/> Guruhni o‘chirish</button>
        </div>
      </div>
    </>
  );
}

export function Groups() {
  const role = useApp((state) => state.user?.role);
  const groups = useGroups();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const group = await api<{ id: number; name: string }>('/groups', 'POST', { action: 'create', name });
      setName('');
      await client.invalidateQueries({ queryKey: ['groups'] });
      showToast(`“${group.name}” guruhi yaratildi.`, 'success');
      setOpenId(group.id);
    } catch (error) {
      showToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (openId) return <GroupView id={openId} onBack={() => setOpenId(null)}/>;
  return (
    <>
      <div className="card">
        <h3 className="card-title"><Plus/> Yangi guruh</h3>
        <form className="flex flex-wrap items-end gap-2.5" onSubmit={create}>
          <div className="min-w-56 flex-1">
            <label htmlFor="groupName" className="field-label">Guruh nomi</label>
            <input id="groupName" className="field" placeholder="Masalan: 301-guruh, Pedagogika 2-kurs" minLength={2} maxLength={100} required value={name} onChange={(e) => setName(e.target.value)}/>
          </div>
          <button type="submit" className="btn-primary" disabled={busy}><Plus/> Guruh yaratish</button>
        </form>
      </div>
      <div className="card">
        <h3 className="card-title"><Users/> {role === 'admin' ? 'Barcha guruhlar' : 'Mening guruhlarim'}</h3>
        {groups.isLoading && <ListSkeleton/>}
        {groups.isSuccess && !groups.data.length && <p className="muted-text empty-text">Hali guruh yo‘q. Yuqorida birinchi guruhni yarating.</p>}
        <div className="group-grid">
          {groups.data?.map((group) => (
            <button key={group.id} type="button" className="group-card" onClick={() => setOpenId(group.id)}>
              <span className="text-lg font-semibold wrap-anywhere text-ink">{group.name}</span>
              <span className="text-sm text-muted">{group.member_count} ta talaba{role === 'admin' && group.teacher_name ? ` · ${group.teacher_name}` : ''}</span>
              <span className="mt-2 font-mono text-sm tracking-[0.2em] text-primary">{group.code}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
