import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="file"]), select, textarea, iframe, [tabindex="0"]';

// Moves focus into an open dialog, keeps Tab inside it and gives focus back when it closes.
export function useModal<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open || !ref.current) return undefined;
    const box = ref.current;
    const returnTo = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      const first = box.querySelector<HTMLElement>('input:not([type=file]):not([disabled]), textarea') || box.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 80);
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      returnTo?.focus?.();
    };
  }, [open]);

  return ref;
}
