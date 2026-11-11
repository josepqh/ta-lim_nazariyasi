import { useQuery } from '@tanstack/react-query';
import { useApp } from '../store';
import type { Article, Certificate, Group, PublicStats } from '../types';
import { api } from './api';

export const imageUrl = (id: string | null | undefined) => (id ? `/api/images?id=${encodeURIComponent(id)}` : null);

export function useGroups() {
  const signedIn = useApp((state) => Boolean(state.user));
  return useQuery({ queryKey: ['groups'], enabled: signedIn, queryFn: () => api<Group[]>('/groups') });
}

export function useCertificates() {
  const isStudent = useApp((state) => state.user?.role === 'student');
  return useQuery({ queryKey: ['certificates'], enabled: isStudent, queryFn: () => api<Certificate[]>('/certificates') });
}

export function useStats() {
  return useQuery({ queryKey: ['stats'], staleTime: 300_000, queryFn: () => api<PublicStats>('/stats') });
}

export function useArticles(all = false) {
  return useQuery({ queryKey: ['articles', all ? 'all' : 'public'], queryFn: () => api<Article[]>(`/articles${all ? '?all=1' : ''}`) });
}

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
export function uzDate(value: string | Date): string {
  const date = new Date(value);
  return `${date.getDate()}-${MONTHS[date.getMonth()]}, ${date.getFullYear()}`;
}

// Shrinks a photo in the browser so a cover fits one request and loads fast everywhere.
export async function prepareCover(file: File, maxWidth = 1200): Promise<{ mime: string; data: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Faqat JPG, PNG yoki WebP rasm tanlang.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Rasm hajmi 15 MB dan oshmasin.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let mime = 'image/webp';
  let url = canvas.toDataURL(mime, 0.82);
  if (!url.startsWith('data:image/webp')) {
    mime = 'image/jpeg';
    url = canvas.toDataURL(mime, 0.85);
  }
  return { mime, data: url.slice(url.indexOf(',') + 1) };
}
