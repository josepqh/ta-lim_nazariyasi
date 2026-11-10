// Sends uncaught browser errors to the server's error log, at most a few per page load.
const MAX_REPORTS = 10;
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i];
let sent = 0;
const seen = new Set<string>();

export function reportClientError(message: string, detail?: string) {
  const text = message.slice(0, 1000);
  if (!text || sent >= MAX_REPORTS || seen.has(text) || IGNORED.some((pattern) => pattern.test(text))) return;
  seen.add(text);
  sent += 1;
  void fetch('/api/errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text, detail: detail?.slice(0, 8000), path: `${location.pathname}${location.hash}` }),
    keepalive: true
  }).catch(() => {
    // Reporting is best effort.
  });
}

export function installErrorReporting() {
  window.addEventListener('error', (event) => {
    reportClientError(event.message || String(event.error), event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportClientError(reason?.message || String(reason), reason?.stack);
  });
}
