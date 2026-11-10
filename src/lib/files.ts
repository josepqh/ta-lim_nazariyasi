import { showToast } from '../store';
import type { StoredFile } from '../types';
import { ApiError, api } from './api';

export const MAX_FILE_SIZE = 30 * 1024 * 1024;
export const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png';

type Purpose = 'content' | 'submission' | 'quiz_source';
interface UploadTarget {
  moduleId?: number;
  stepType: string;
  purpose: Purpose;
}
type InitResponse =
  | { id: string; mode: 'direct'; upload_url: string }
  | { id: string; mode: 'chunks'; chunk_size: number; total_chunks: number };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// XMLHttpRequest, because fetch cannot report upload progress.
function putWithProgress(url: string, file: File, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => (request.status < 300 ? resolve() : reject(new ApiError('Faylni yuklab bo‘lmadi. Qayta urinib ko‘ring.', request.status)));
    request.onerror = () => reject(new ApiError('Server bilan aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring.', 0));
    request.send(file);
  });
}

// Storage takes the file straight from the browser; without it the file goes to the API in 3 MB chunks.
export async function uploadFile(file: File, { moduleId, stepType, purpose }: UploadTarget, onProgress?: (percent: number) => void): Promise<StoredFile> {
  if (file.size > MAX_FILE_SIZE) throw new ApiError('Fayl hajmi 30 MB dan oshmasin.', 413);
  if (file.size === 0) throw new ApiError('Fayl bo‘sh.', 400);
  const started = await api<InitResponse>('/files', 'POST', {
    action: 'init', module_id: moduleId, step_type: stepType, purpose, filename: file.name, size: file.size
  });
  if (started.mode === 'direct') {
    await putWithProgress(started.upload_url, file, onProgress);
  } else {
    for (let index = 0; index < started.total_chunks; index++) {
      const start = index * started.chunk_size;
      const buffer = await file.slice(start, start + started.chunk_size).arrayBuffer();
      await api('/files', 'POST', { action: 'chunk', id: started.id, index, data: bytesToBase64(new Uint8Array(buffer)) });
      onProgress?.(Math.round(((index + 1) / started.total_chunks) * 100));
    }
  }
  return api<StoredFile>('/files', 'POST', { action: 'complete', id: started.id });
}

const FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain'
};

// Browsers embedded in apps (Telegram, Instagram, Facebook) cannot save blob downloads:
// they navigate to the blob instead and the visitor loses the site.
function isInAppBrowser(): boolean {
  return 'TelegramWebviewProxy' in window || /Telegram|FBAN|FBAV|Instagram|Line\//i.test(navigator.userAgent);
}

function canShareFile(file: File): boolean {
  return window.matchMedia('(pointer: coarse)').matches
    && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [file] });
}

export async function shareFile(file: File) {
  try {
    await navigator.share({ files: [file] });
  } catch (error) {
    if ((error as Error).name !== 'AbortError') throw error;
  }
}

function clickLink(href: string, filename?: string) {
  const link = document.createElement('a');
  link.href = href;
  if (filename) link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export type DownloadResult = { kind: 'done' } | { kind: 'needsTap'; file: File };

// Phones get the system share sheet (save to Files, open in PowerPoint) and stay on the page.
async function deliver(parts: Uint8Array<ArrayBuffer>[], name: string): Promise<DownloadResult> {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const file = new File(parts, name, { type: FILE_TYPES[extension] || 'application/octet-stream' });
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file] });
    } catch (error) {
      const name = (error as Error).name;
      if (name === 'NotAllowedError') return { kind: 'needsTap', file };
      if (name !== 'AbortError') throw error;
    }
    return { kind: 'done' };
  }
  if (isInAppBrowser()) {
    showToast('Ilova ichidagi brauzer faylni saqlay olmaydi. Saytni Safari yoki Chrome’da ochib, qayta yuklang.', 'warning');
    return { kind: 'done' };
  }
  // octet-stream keeps uploaded content from ever rendering on this origin.
  const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
  clickLink(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { kind: 'done' };
}

// A file in Storage arrives as a short-lived link that answers with "attachment", so it downloads in place.
export async function downloadFile(id: string, onProgress?: (percent: number) => void): Promise<DownloadResult> {
  const meta = await api<{ name: string; url?: string; total_chunks?: number }>(`/files?id=${encodeURIComponent(id)}`);
  if (meta.url) {
    clickLink(meta.url);
    return { kind: 'done' };
  }
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const total = meta.total_chunks ?? 0;
  for (let chunk = 0; chunk < total; chunk++) {
    const { data } = await api<{ data: string }>(`/files?id=${encodeURIComponent(id)}&chunk=${chunk}`);
    parts.push(base64ToBytes(data));
    onProgress?.(Math.round(((chunk + 1) / total) * 100));
  }
  return deliver(parts, meta.name);
}
