import { Download } from 'lucide-react';
import { useRef, useState } from 'react';
import { downloadFile, shareFile } from '../lib/files';
import { formatFileSize } from '../lib/format';
import { openAuth, showToast, useApp } from '../store';
import type { StoredFile } from '../types';

export function FileCard({ file }: { file?: StoredFile | null }) {
  const signedIn = useApp((state) => Boolean(state.user));
  const [label, setLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A file fetched earlier waits for a fresh tap, which the share sheet requires.
  const ready = useRef<File | null>(null);
  if (!file?.id) return null;

  async function onClick() {
    if (!signedIn) {
      useApp.setState({ contentModal: null });
      openAuth('login');
      showToast('Faylni yuklab olish uchun tizimga kiring.', 'warning');
      return;
    }
    if (ready.current) {
      const waiting = ready.current;
      ready.current = null;
      setLabel(null);
      shareFile(waiting).catch((error: Error) => showToast(error.message, 'error'));
      return;
    }
    setBusy(true);
    try {
      const result = await downloadFile(file!.id, (percent) => setLabel(`Yuklanmoqda ${percent}%`));
      if (result.kind === 'needsTap') {
        ready.current = result.file;
        setLabel('Tayyor · saqlash uchun bosing');
      } else {
        setLabel(null);
      }
    } catch (error) {
      setLabel(null);
      showToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="file-card" disabled={busy} onClick={onClick}>
      <Download />
      <span className="file-card-text">
        <span className="file-card-name">{file.name}</span>
        <span className="file-card-meta">{label ?? `${formatFileSize(file.size)} · Yuklab olish`}</span>
      </span>
    </button>
  );
}
