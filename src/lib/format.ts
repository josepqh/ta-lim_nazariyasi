export const ROLE_LABELS = { student: 'Talaba', teacher: 'O‘qituvchi', admin: 'Administrator' } as const;

export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('uz-UZ') : '—';
}

export function formatFileSize(bytes: number): string {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

export function motionAllowed(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function youTubeEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    let videoId = '';
    if (host === 'youtu.be') {
      videoId = url.pathname.slice(1).split('/')[0] ?? '';
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
      if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
      else videoId = url.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/)?.[1] || '';
    }
    return /^[\w-]{11}$/.test(videoId) ? `https://www.youtube-nocookie.com/embed/${videoId}` : null;
  } catch {
    return null;
  }
}
