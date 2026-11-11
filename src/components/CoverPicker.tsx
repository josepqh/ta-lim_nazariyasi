import { ImagePlus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { api } from '../lib/api';
import { imageUrl, prepareCover } from '../lib/learning';
import { showToast } from '../store';

interface Props {
  value: string | null;
  onChange: (id: string | null) => void | Promise<void>;
  label?: string;
}

// Picks a cover photo, shrinks it in the browser, uploads it and hands back its id.
export function CoverPicker({ value, onChange, label = 'Muqova rasmi' }: Props) {
  const id = useId();
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const prepared = await prepareCover(file);
      const { id: imageId } = await api<{ id: string }>('/images', 'POST', prepared);
      await onChange(imageId);
    } catch (error) {
      showToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cover-picker">
      {value ? <img src={imageUrl(value)!} alt="" className="cover-preview"/> : <span className="cover-empty"><ImagePlus/></span>}
      <div className="flex flex-wrap gap-2">
        <input id={id} type="file" accept="image/jpeg,image/png,image/webp" className="peer sr-only" disabled={busy} onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ''; }}/>
        <label htmlFor={id} className="btn-outline btn-sm cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40"><ImagePlus/> {busy ? 'Yuklanmoqda…' : value ? 'Rasmni almashtirish' : label}</label>
        {value && <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => void onChange(null)}><Trash2/> Olib tashlash</button>}
      </div>
    </div>
  );
}
