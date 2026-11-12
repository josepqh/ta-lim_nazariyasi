import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from '../lib/report';

interface Props {
  children: ReactNode;
  // 'page' fills a content area; 'app' is the last resort around the whole site.
  variant?: 'page' | 'app';
}

// A crash inside one page shows a message there instead of blanking the whole site,
// and the error goes to the administrator's log.
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(error.message || String(error), `${error.stack ?? ''}\n${info.componentStack ?? ''}`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const app = this.props.variant === 'app';
    return (
      <div role="alert" className={app ? 'grid min-h-dvh place-items-center bg-page p-6' : 'px-4 py-16'}>
        <div className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
          <TriangleAlert className="mx-auto size-10 text-primary" aria-hidden="true"/>
          <h2 className="mt-4 text-xl font-bold text-ink">Nimadir xato ketdi</h2>
          <p className="mt-2 text-muted">Bu sahifani ochib bo‘lmadi. Xato haqida administratorga xabar berildi.</p>
          <button type="button" className="btn btn-solid mt-6" onClick={() => (app ? location.reload() : this.setState({ failed: false }))}>
            <RotateCcw/> Qayta urinish
          </button>
        </div>
      </div>
    );
  }
}
