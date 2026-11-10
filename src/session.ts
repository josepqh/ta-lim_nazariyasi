import { api } from './lib/api';
import { keys, queryClient } from './lib/queries';
import { navigate, restoreRoute, showSection, showToast, useApp } from './store';
import type { User } from './types';

// After sign-in the cabinet opens; after a refresh on the public site the visitor stays there.
export async function startSession(user: User, { stayOnSite = false } = {}) {
  queryClient.removeQueries({ queryKey: ['progress'] });
  useApp.setState({ user, authOpen: false });
  if (stayOnSite) return;
  if (!restoreRoute()) navigate('home');
}

export async function logout() {
  try {
    await api('/auth', 'POST', { action: 'logout' });
  } catch {
    // The cookie expires on its own; the visitor is signed out here either way.
  }
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'modules' });
  useApp.setState({ user: null, view: 'site', sidebarOpen: false, contentModal: null, lessonPreview: false });
  showSection('home');
  showToast('Tizimdan muvaffaqiyatli chiqildi.', 'info');
}

export function invalidateProgress() {
  return queryClient.invalidateQueries({ queryKey: keys.myProgress });
}
