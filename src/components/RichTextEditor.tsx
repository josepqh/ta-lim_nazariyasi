import { Bold, Eye, Heading2, Italic, Link2, List, ListOrdered, Pencil, Quote } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/format';
import { Markdown } from './Markdown';

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
}

// A writing field with formatting buttons. It stores Markdown, which the Markdown component shows
// to students; the toolbar and keyboard shortcuts (Ctrl/Cmd + B, I, K) write the marks for the teacher.
export function RichTextEditor({ id, value, onChange, rows = 5, maxLength = 30000, placeholder }: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  function apply(edit: (selected: string) => { text: string; select?: [number, number] }, lineStart = false) {
    const field = area.current;
    if (!field) return;
    let start = field.selectionStart;
    const end = field.selectionEnd;
    if (lineStart) start = value.lastIndexOf('\n', start - 1) + 1;
    const { text, select } = edit(value.slice(start, end));
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next.slice(0, maxLength));
    requestAnimationFrame(() => {
      field.focus();
      // Offsets are relative to where the inserted text begins.
      const [from, to] = select ?? [text.length, text.length];
      field.setSelectionRange(start + from, start + to);
    });
  }

  const wrap = (mark: string, fallback: string) => apply((selected) => {
    const inner = selected || fallback;
    return { text: `${mark}${inner}${mark}`, select: [mark.length, mark.length + inner.length] };
  });
  const prefixLines = (prefix: (n: number) => string) => apply((selected) => {
    const text = (selected || 'Matn').split('\n').map((line, n) => `${prefix(n)}${line.replace(/^(#{2,3}\s|\s*[-*]\s+|\s*\d+[.)]\s+|>\s?)/, '')}`).join('\n');
    return { text, select: [0, text.length] };
  }, true);
  const link = () => apply((selected) => {
    const label = selected || 'havola matni';
    const text = `[${label}](https://)`;
    return { text, select: [label.length + 3, text.length - 1] };
  });

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'b') { event.preventDefault(); wrap('**', 'qalin matn'); }
    if (key === 'i') { event.preventDefault(); wrap('*', 'kursiv matn'); }
    if (key === 'k') { event.preventDefault(); link(); }
  }

  const tool = (label: string, icon: ReactNode, action: () => void) => (
    <button type="button" className="rte-tool" aria-label={label} title={label} disabled={preview} onClick={action}>{icon}</button>
  );

  return (
    <div className="rte">
      <div className="rte-bar" role="toolbar" aria-label="Matnni bezash" aria-controls={id}>
        {tool('Qalin (Ctrl+B)', <Bold/>, () => wrap('**', 'qalin matn'))}
        {tool('Kursiv (Ctrl+I)', <Italic/>, () => wrap('*', 'kursiv matn'))}
        {tool('Sarlavha', <Heading2/>, () => prefixLines(() => '## '))}
        {tool('Ro‘yxat', <List/>, () => prefixLines(() => '- '))}
        {tool('Raqamli ro‘yxat', <ListOrdered/>, () => prefixLines((n) => `${n + 1}. `))}
        {tool('Iqtibos', <Quote/>, () => prefixLines(() => '> '))}
        {tool('Havola (Ctrl+K)', <Link2/>, link)}
        <span className="ml-auto inline-flex">
          <button type="button" className={cx('rte-mode', !preview && 'active')} aria-pressed={!preview} onClick={() => setPreview(false)}><Pencil/> Yozish</button>
          <button type="button" className={cx('rte-mode', preview && 'active')} aria-pressed={preview} onClick={() => setPreview(true)}><Eye/> Ko‘rinishi</button>
        </span>
      </div>
      <textarea ref={area} id={id} className={cx('rte-area', preview && 'hidden')} rows={rows} maxLength={maxLength} placeholder={placeholder}
        value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKey}/>
      {preview && (
        <div className="rte-preview">{value.trim() ? <Markdown text={value}/> : <p className="text-muted">Hali hech narsa yozilmagan.</p>}</div>
      )}
    </div>
  );
}
