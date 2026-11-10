import type { LucideIcon } from 'lucide-react';
import { CircleHelp, CirclePlay, Feather, FileText, Presentation, UploadCloud } from 'lucide-react';
import type { Module, StepContent, StepId, User } from '../types';

export interface StepType {
  id: StepId;
  title: string;
  name: string;
  short: string;
  kind: 'quiz' | 'video' | 'doc' | 'upload' | 'text';
  icon: LucideIcon;
}

export const STEP_TYPES: StepType[] = [
  { id: 'diag', title: '1. Diagnostika testi', name: 'Diagnostika testi', short: 'Diagnostika', kind: 'quiz', icon: CircleHelp },
  { id: 'video', title: '2. Video dars', name: 'Video dars', short: 'Video dars', kind: 'video', icon: CirclePlay },
  { id: 'pres', title: '3. Taqdimot (Prezentatsiya)', name: 'Taqdimot (Prezentatsiya)', short: 'Taqdimot', kind: 'doc', icon: Presentation },
  { id: 'doc', title: '4. Qo‘shimcha material', name: 'Qo‘shimcha material', short: 'Material', kind: 'doc', icon: FileText },
  { id: 'task', title: '5. Amaliy topshiriq', name: 'Amaliy topshiriq', short: 'Topshiriq', kind: 'upload', icon: UploadCloud },
  { id: 'refl', title: '6. Refleksiya', name: 'Refleksiya', short: 'Refleksiya', kind: 'text', icon: Feather }
];

export const STAFF_ROLES = ['teacher', 'admin'] as const;
export const isStaff = (user: User | null | undefined) => user?.role === 'teacher' || user?.role === 'admin';

// Mirrors the server rule: a teacher manages the modules they created, the administrator all of them.
export function canManage(user: User | null | undefined, module: Module | null | undefined): boolean {
  if (!user || !module) return false;
  return user.role === 'admin' || (user.role === 'teacher' && Number(module.created_by) === Number(user.id));
}

export function stepHasMaterial(content: StepContent | undefined | null): boolean {
  return Boolean(content?.value || content?.file?.id || content?.questions_count || content?.questions?.length);
}
