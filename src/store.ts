import { create } from 'zustand';
import type { Role, User } from './types';

export type PublicSection = 'home' | 'public-modules' | 'public-module-view' | 'public-news' | 'public-contact' | 'privacy' | 'terms';
export type PageId =
  | 'home' | 'modules' | 'module-view' | 'manage-modules' | 'analytics' | 'submissions'
  | 'student-detail' | 'users' | 'user-profile' | 'profile' | 'errors';
export type AuthView = 'login' | 'register' | 'registerCode' | 'forgot' | 'forgotCode' | 'pending';
export type ToastType = 'success' | 'error' | 'warning' | 'info';
export type UsersTab = 'student' | 'teacher' | 'pending';

// Sections that keep their own address, so a refresh reopens them.
export const PUBLIC_ROUTES: PublicSection[] = ['public-modules', 'public-news', 'public-contact', 'privacy', 'terms'];
const STAFF: Role[] = ['teacher', 'admin'];
export const PAGE_ROLES: Partial<Record<PageId, Role[]>> = {
  analytics: STAFF,
  submissions: STAFF,
  'manage-modules': STAFF,
  'student-detail': STAFF,
  users: ['admin'],
  'user-profile': ['admin'],
  errors: ['admin']
};
const ID_PAGES: PageId[] = ['module-view', 'student-detail', 'user-profile'];
const KNOWN_PAGES: PageId[] = ['home', 'modules', 'module-view', 'manage-modules', 'analytics', 'submissions', 'student-detail', 'users', 'user-profile', 'profile', 'errors'];

interface Toast {
  message: string;
  type: ToastType;
  key: number;
}

interface AppState {
  user: User | null;
  booted: boolean;
  view: 'site' | 'cabinet';
  section: PublicSection;
  publicModuleId: number | null;
  page: PageId;
  routeId: number | null;
  titleOverride: string | null;
  sidebarOpen: boolean;
  lessonPreview: boolean;
  lessonFocus: number | null;
  editModuleId: number | null;
  usersTab: UsersTab;
  usersQuery: string;
  usersPage: number;
  authOpen: boolean;
  authView: AuthView;
  toast: Toast | null;
  contentModal: { moduleId: number; stepId: string } | null;
  theme: 'light' | 'dark';
}

export const useApp = create<AppState>(() => ({
  user: null,
  booted: false,
  view: 'site',
  section: 'home',
  publicModuleId: null,
  page: 'home',
  routeId: null,
  titleOverride: null,
  sidebarOpen: false,
  lessonPreview: false,
  lessonFocus: null,
  editModuleId: null,
  usersTab: 'student',
  usersQuery: '',
  usersPage: 1,
  authOpen: false,
  authView: 'login',
  toast: null,
  contentModal: null,
  theme: currentTheme()
}));

const set = useApp.setState;
const get = useApp.getState;

function writeHash(hash: string) {
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
}

export function showToast(message: string, type: ToastType = 'success') {
  set({ toast: { message, type, key: Date.now() } });
}

// ===== Public site =====
export function showSection(section: PublicSection) {
  set({ section, view: 'site' });
  writeHash(PUBLIC_ROUTES.includes(section) ? `#${section}` : '');
  window.scrollTo(0, 0);
}

export function restorePublicSection(): boolean {
  const id = location.hash.slice(1) as PublicSection;
  if (!PUBLIC_ROUTES.includes(id)) return false;
  set({ section: id });
  return true;
}

export function openAuth(view: AuthView) {
  // Signed-in visitors have nothing to sign up for: take them to their cabinet.
  if (get().user) {
    navigate('home');
    return;
  }
  set({ authOpen: true, authView: view });
}

export function closeAuth() {
  set({ authOpen: false });
}

export function returnToWebsite() {
  set({ view: 'site', sidebarOpen: false });
  showSection('home');
}

// ===== Cabinet =====
export function navigate(page: PageId, routeId: number | null = null) {
  const role = get().user?.role;
  const allowed = PAGE_ROLES[page];
  if (allowed && (!role || !allowed.includes(role))) {
    page = 'home';
    routeId = null;
  }
  set({ view: 'cabinet', page, routeId, titleOverride: null, sidebarOpen: false, contentModal: null });
  writeHash(`#/${page}${ID_PAGES.includes(page) && routeId ? `/${routeId}` : ''}`);
}

export function openModule(id: number) {
  set({ lessonPreview: false, lessonFocus: null });
  navigate('module-view', id);
}

export function openUsers(tab: UsersTab) {
  set({ usersTab: tab, usersPage: 1, usersQuery: '' });
  navigate('users');
}

// Cabinet addresses look like #/page or #/page/42.
export function restoreRoute(): boolean {
  const match = location.hash.match(/^#\/([a-z-]+)(?:\/(\d+))?$/);
  if (!match) return false;
  const page = match[1] as PageId;
  if (!KNOWN_PAGES.includes(page)) return false;
  const id = match[2] ? Number(match[2]) : null;
  if (ID_PAGES.includes(page) && !id) return false;
  navigate(page, id);
  return true;
}

export function setTitle(title: string | null) {
  if (get().titleOverride !== title) set({ titleOverride: title });
}

// ===== Theme =====
function currentTheme(): 'light' | 'dark' {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'dark' || chosen === 'light') return chosen;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('theme', next);
  } catch {
    // Storage unavailable: the choice lasts for this visit only.
  }
  set({ theme: next });
}
