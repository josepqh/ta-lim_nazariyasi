import { QueryClient, useQuery } from '@tanstack/react-query';
import { useApp } from '../store';
import type { ContentRow, Module, Progress, StepContent, StepId } from '../types';
import { api } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    // Pages show what is cached at once and refresh it on every visit, like the server-rendered lists did.
    queries: { staleTime: 0, retry: 1, refetchOnWindowFocus: false }
  }
});

export const keys = {
  modules: ['modules'] as const,
  deletedModules: ['modules', 'deleted'] as const,
  myProgress: ['progress', 'mine'] as const,
  content: (moduleId: number) => ['content', moduleId] as const,
  progress: (query: string) => ['progress', query] as const
};

export function useModules() {
  return useQuery({ queryKey: keys.modules, queryFn: () => api<Module[]>('/modules') });
}

// A student's own progress, keyed by module id. Staff have none of their own.
export function useMyProgress() {
  const role = useApp((state) => state.user?.role);
  return useQuery({
    queryKey: keys.myProgress,
    enabled: role === 'student',
    queryFn: async () => {
      const rows = await api<Progress[]>('/progress');
      return Object.fromEntries(rows.map((row) => [row.module_id, row])) as Record<number, Progress>;
    }
  });
}

export function useContent(moduleId: number | null) {
  return useQuery({
    queryKey: keys.content(moduleId ?? 0),
    enabled: Boolean(moduleId),
    queryFn: async () => {
      const rows = await api<ContentRow[]>(`/content?module_id=${moduleId}`);
      return Object.fromEntries(rows.map((row) => [row.step_type, row.content ?? {}])) as Partial<Record<StepId, StepContent>>;
    }
  });
}

export function refreshModules() {
  return queryClient.invalidateQueries({ queryKey: keys.modules });
}
