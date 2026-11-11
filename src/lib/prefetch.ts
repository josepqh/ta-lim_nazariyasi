import type { PageId } from '../store';
import { useApp } from '../store';
import { api } from './api';
import { keys, queryClient } from './queries';

// Starts a page's request when the pointer reaches its link, so the data is often there by the click.
export function prefetchPage(page: PageId) {
  const fetch = (queryKey: readonly unknown[], endpoint: string) =>
    queryClient.prefetchQuery({ queryKey, queryFn: () => api(endpoint), staleTime: 10_000 });
  const state = useApp.getState();
  void fetch(keys.modules, '/modules');
  if (page === 'analytics') void fetch(['progress', 'all'], '/progress');
  if (page === 'profile') void fetch(['profile'], '/profile');
  if (page === 'groups') void fetch(['groups'], '/groups');
  if (page === 'articles') void fetch(['articles', 'all'], '/articles?all=1');
  if (page === 'errors') void fetch(['audit', 1], '/audit?page=1');
  if (page === 'errors') void fetch(['errors', 1], '/errors?page=1');
  if (page === 'home' && state.user?.role === 'admin') void fetch(['users', 'counts'], '/users?page_size=1');
  if (page === 'users') {
    const params = state.usersTab === 'pending' ? 'status=pending' : `role=${state.usersTab}`;
    void fetch(['users', state.usersTab, state.usersQuery, 1], `/users?page=1&${params}${state.usersQuery ? `&q=${encodeURIComponent(state.usersQuery)}` : ''}`);
  }
}

export function prefetchModule(moduleId: number) {
  void queryClient.prefetchQuery({ queryKey: keys.content(moduleId), staleTime: 10_000, queryFn: async () => {
    const rows = await api<{ step_type: string; content: unknown }[]>(`/content?module_id=${moduleId}`);
    return Object.fromEntries(rows.map((row) => [row.step_type, row.content ?? {}]));
  } });
}

