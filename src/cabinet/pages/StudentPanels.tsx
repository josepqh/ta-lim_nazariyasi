import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Award, Copy, Download, LogOut, PlayCircle, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { downloadCertificate, verifyUrl } from '../../lib/certificate';
import { imageUrl, useCertificates, useGroups, uzDate } from '../../lib/learning';
import { useModules, useMyProgress } from '../../lib/queries';
import { STEP_TYPES } from '../../lib/steps';
import { openModule, showToast } from '../../store';
import type { Certificate } from '../../types';

// The module a student is in the middle of, or the first one not yet started.
export function ContinueCard() {
  const modules = useModules();
  const progress = useMyProgress();
  const list = modules.data ?? [];
  if (!list.length || !progress.isSuccess) return null;
  const rows = progress.data;
  const started = list.find((module) => {
    const steps = rows[module.id]?.completed_steps.length ?? 0;
    return steps > 0 && steps < 6;
  });
  const next = started ?? list.find((module) => !rows[module.id]);
  if (!next) {
    return (
      <div id="continueCard" className="continue-card">
        <span className="continue-icon"><Award/></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary">Barcha modullar tamomlandi</p>
          <p className="mt-0.5 text-lg font-semibold text-ink">Ajoyib natija! Sertifikatlaringiz pastda.</p>
        </div>
      </div>
    );
  }
  const done = rows[next.id]?.completed_steps.length ?? 0;
  const step = STEP_TYPES[Math.min(done, 5)]!;
  return (
    <div id="continueCard" className="continue-card">
      {next.cover_image_id
        ? <img src={imageUrl(next.cover_image_id)!} alt="" className="continue-cover"/>
        : <span className="continue-icon"><PlayCircle/></span>}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-primary">{started ? 'O‘qishni davom ettiring' : 'Keyingi modul'}</p>
        <p className="mt-0.5 text-lg leading-snug font-semibold wrap-anywhere text-ink">Modul {next.order_num}. {next.title}</p>
        <p className="mt-1 text-sm text-muted">{done + 1}-qadam: {step.name} · {done}/6 bajarildi</p>
        <div className="mt-3 h-1.5 max-w-sm overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((done / 6) * 100)}%` }}/></div>
      </div>
      <button type="button" className="btn-primary shrink-0" onClick={() => openModule(next.id)}>{started ? 'Davom etish' : 'Boshlash'} <ArrowRight/></button>
    </div>
  );
}

function CertificateRow({ certificate }: { certificate: Certificate }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      await downloadCertificate(certificate);
    } catch (error) {
      showToast((error as Error).message || 'Sertifikatni tayyorlab bo‘lmadi.', 'error');
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(verifyUrl(certificate.code));
      showToast('Tekshirish havolasi nusxalandi.', 'success');
    } catch {
      showToast(verifyUrl(certificate.code), 'info');
    }
  }
  return (
    <li className="certificate-row">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Award/></span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold wrap-anywhere text-ink">{certificate.module_title}</p>
        <p className="text-sm text-muted">{uzDate(certificate.issued_at)} · {certificate.score} ball · № {certificate.code}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button type="button" className="btn-outline btn-sm" onClick={copy}><Copy/> Havola</button>
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={download}><Download/> {busy ? 'Tayyorlanmoqda…' : 'PDF'}</button>
      </div>
    </li>
  );
}

export function CertificatesCard() {
  const certificates = useCertificates();
  if (!certificates.data?.length) return null;
  return (
    <section id="certificatesCard" className="card">
      <h3 className="card-title"><Award/> Sertifikatlarim</h3>
      <ul className="divide-y divide-line">{certificates.data.map((certificate) => <CertificateRow key={certificate.code} certificate={certificate}/>)}</ul>
    </section>
  );
}

export function StudentGroupsCard() {
  const groups = useGroups();
  const client = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function join(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const group = await api<{ name: string }>('/groups', 'POST', { action: 'join', code });
      setCode('');
      showToast(`“${group.name}” guruhiga qo‘shildingiz.`, 'success');
      await client.invalidateQueries({ queryKey: ['groups'] });
    } catch (joinError) {
      setError((joinError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function leave(id: number, name: string) {
    if (!window.confirm(`“${name}” guruhidan chiqasizmi?`)) return;
    try {
      await api('/groups', 'POST', { action: 'leave', id });
      await client.invalidateQueries({ queryKey: ['groups'] });
    } catch (leaveError) {
      showToast((leaveError as Error).message, 'error');
    }
  }

  return (
    <section id="studentGroups" className="card">
      <h3 className="card-title"><Users/> Guruhlarim</h3>
      {Boolean(groups.data?.length) && (
        <ul className="mb-4 divide-y divide-line">
          {groups.data!.map((group) => (
            <li key={group.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0"><p className="font-semibold text-ink">{group.name}</p><p className="text-sm text-muted">O‘qituvchi: {group.teacher_name}</p></div>
              <button type="button" className="btn-outline btn-sm" onClick={() => leave(group.id, group.name)}><LogOut/> Chiqish</button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-wrap items-end gap-2.5" onSubmit={join}>
        <div className="min-w-48 flex-1">
          <label htmlFor="groupCode" className="field-label">O‘qituvchi bergan guruh kodi</label>
          <input id="groupCode" className="field tracking-[0.25em] uppercase" placeholder="ABC234" maxLength={8} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} required/>
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>Guruhga qo‘shilish</button>
      </form>
      <div className="mt-2 min-h-5 text-sm text-danger" role="alert">{error}</div>
    </section>
  );
}
