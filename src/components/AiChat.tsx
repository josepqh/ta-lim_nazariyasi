import { Bot, RotateCcw, Send, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { isStaff } from '../lib/steps';
import { useApp } from '../store';

const EMPTY_TEXT = 'Dars rejasi, test savollari yoki baholash mezonlari bo‘yicha savol bering.';
const MAX_HISTORY = 29;

interface Message {
  role: 'user' | 'assistant';
  content: string;
}
interface Bubble {
  kind: 'user' | 'assistant' | 'error';
  text: string;
  pending?: boolean;
}

// Teachers and the administrator only. React renders every reply as text, never as HTML.
export function AiChat() {
  const user = useApp((state) => state.user);
  const allowed = isStaff(user);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<Message[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (allowed) return;
    setOpen(false);
    setHistory([]);
    setBubbles([]);
  }, [allowed]);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [bubbles]);

  // Escape closes the panel like the other dialogs.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setInput('');
    // Keeps complete question-answer pairs, so the list always starts with the user's turn.
    const recent = history.slice(-(MAX_HISTORY - (MAX_HISTORY % 2 ? 1 : 0)));
    const messages: Message[] = [...recent, { role: 'user', content: text }];
    setBubbles((old) => [...old, { kind: 'user', text }, { kind: 'assistant', text: 'Yozmoqda…', pending: true }]);
    try {
      const { reply } = await api<{ reply: string }>('/chat', 'POST', { messages });
      setBubbles((old) => [...old.slice(0, -1), { kind: 'assistant', text: reply }]);
      setHistory([...messages, { role: 'assistant', content: reply }]);
    } catch (error) {
      setBubbles((old) => [...old.slice(0, -1), { kind: 'error', text: (error as Error).message }]);
      setInput((current) => current || text);
    } finally {
      setBusy(false);
      field.current?.focus();
    }
  }

  function reset() {
    setHistory([]);
    setBubbles([]);
  }

  return (
    <div id="aiChat" className="ai-chat" hidden={!allowed}>
      <section id="aiChatPanel" className="ai-chat-panel" role="dialog" aria-labelledby="aiChatTitle" hidden={!open}>
        <header className="ai-chat-header">
          <h3 id="aiChatTitle"><Bot/> AI yordamchi</h3>
          <div className="ai-chat-actions">
            <button type="button" aria-label="Yangi suhbat" title="Yangi suhbat" onClick={reset}><RotateCcw/></button>
            <button type="button" aria-label="Yopish" title="Yopish" onClick={() => setOpen(false)}><X/></button>
          </div>
        </header>
        <div ref={list} id="aiChatMessages" className="ai-chat-messages" aria-live="polite">
          {!bubbles.length && <p className="ai-chat-empty">{EMPTY_TEXT}</p>}
          {bubbles.map((bubble, index) => (
            <div key={index} className={`ai-chat-bubble ai-chat-${bubble.kind}${bubble.pending ? ' ai-chat-pending' : ''}`} role={bubble.kind === 'error' ? 'alert' : undefined}>
              {bubble.text}
            </div>
          ))}
        </div>
        <form className="ai-chat-form" onSubmit={send}>
          <label htmlFor="aiChatInput" className="visually-hidden">Xabaringiz</label>
          <textarea ref={field} id="aiChatInput" rows={2} maxLength={8000} placeholder="Savolingizni yozing…" value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}/>
          <button type="submit" id="aiChatSend" className="ai-chat-send" aria-label="Yuborish" disabled={busy}><Send/></button>
        </form>
      </section>
      <button type="button" id="aiChatToggle" className="ai-chat-toggle" aria-label={open ? 'AI yordamchini yopish' : 'AI yordamchini ochish'}
        aria-expanded={open} aria-controls="aiChatPanel" onClick={() => setOpen((value) => !value)}>
        <Bot/>
      </button>
    </div>
  );
}
