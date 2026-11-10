import { FileCheck2, UploadCloud } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { formatFileSize } from '../lib/format';

interface Props {
  id: string;
  accept: string;
  hint?: string;
  file: File | null;
  onChange: (file: File | null) => void;
}

// A styled, Uzbek stand-in for the browser's own file field. The real input stays in the page
// (visually hidden) so keyboards, screen readers and tests use it as before.
export function FilePicker({ id, accept, hint, file, onChange }: Props) {
  const [dragging, setDragging] = useState(false);

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) onChange(dropped);
  }

  return (
    <div className="file-picker">
      <input
        type="file"
        id={id}
        className="peer sr-only"
        accept={accept}
        aria-describedby={hint ? `${id}Hint` : undefined}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <label
        htmlFor={id}
        className={`file-picker-box${dragging ? ' dragging' : ''}${file ? ' chosen' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {file ? <FileCheck2 className="size-6 text-primary"/> : <UploadCloud className="size-6 text-muted"/>}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold wrap-anywhere text-ink">{file ? file.name : 'Fayl tanlang yoki shu yerga tashlang'}</span>
          <span className="block text-sm text-muted">{file ? `${formatFileSize(file.size)} · boshqasini tanlash uchun bosing` : 'Kompyuter yoki telefondan'}</span>
        </span>
        <span className="file-picker-action">{file ? 'Almashtirish' : 'Tanlash'}</span>
      </label>
      {hint && <small id={`${id}Hint`} className="field-hint">{hint}</small>}
    </div>
  );
}
