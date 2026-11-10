import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../store';

const ICONS = { success: CircleCheck, error: TriangleAlert, warning: CircleAlert, info: Info };

export function Toast() {
  const toast = useApp((state) => state.toast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) return undefined;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const Icon = ICONS[toast?.type ?? 'info'];
  return (
    <div id="toast" className={`toast toast-${toast?.type ?? 'info'}${visible ? ' show' : ''}`} role="status" aria-live="polite">
      {toast && <><Icon /> <span>{toast.message}</span></>}
    </div>
  );
}
