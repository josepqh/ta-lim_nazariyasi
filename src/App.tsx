import { useEffect } from 'react';
import { AiChat } from './components/AiChat';
import { AuthModal } from './components/AuthModal';
import { ContentModal } from './components/ContentModal';
import { Toast } from './components/Toast';
import { Cabinet } from './cabinet/Cabinet';
import { api } from './lib/api';
import { keys, queryClient } from './lib/queries';
import { startSession } from './session';
import { PublicSite } from './site/PublicSite';
import { closeAuth, restorePublicSection, restoreRoute, useApp } from './store';
import type { Module, User } from './types';

async function boot() {
  restorePublicSection();
  const [, session] = await Promise.allSettled([
    queryClient.prefetchQuery({ queryKey: keys.modules, queryFn: () => api<Module[]>('/modules') }),
    api<{ user: User | null }>('/auth')
  ]);
  if (session.status === 'fulfilled' && session.value.user) {
    // A refresh on the public site stays there; only cabinet addresses (#/...) reopen the cabinet.
    await startSession(session.value.user, { stayOnSite: !location.hash.startsWith('#/') });
  }
  useApp.setState({ booted: true });
}

export function App() {
  useEffect(() => {
    void boot();

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      const state = useApp.getState();
      if (state.authOpen) closeAuth();
      if (state.contentModal) useApp.setState({ contentModal: null });
      if (state.sidebarOpen) useApp.setState({ sidebarOpen: false });
    }
    // Without a saved choice the page follows the system theme as it changes.
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    function onScheme() {
      if (!document.documentElement.dataset.theme) useApp.setState({ theme: scheme.matches ? 'dark' : 'light' });
    }
    // Typing or pasting an address (#verify/CODE, #/modules) on an open page goes there too.
    // The app itself rewrites the address with replaceState, which does not fire this event.
    function onHash() {
      if (location.hash.startsWith('#/') && useApp.getState().user) restoreRoute();
      else if (!location.hash.startsWith('#/')) {
        if (!restorePublicSection()) useApp.setState({ section: 'home', sectionParam: null });
        useApp.setState({ view: 'site' });
      }
    }
    document.addEventListener('keydown', onKey);
    scheme.addEventListener('change', onScheme);
    window.addEventListener('hashchange', onHash);
    return () => {
      document.removeEventListener('keydown', onKey);
      scheme.removeEventListener('change', onScheme);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  function skipToContent(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const target = document.getElementById(useApp.getState().view === 'cabinet' ? 'mainContent' : 'home');
    target?.setAttribute('tabindex', '-1');
    target?.focus();
  }

  return (
    <>
      <a className="fixed -top-16 left-3 z-[3000] rounded-xl bg-ink px-4 py-2.5 text-surface focus:top-3" href="#mainContent" onClick={skipToContent}>Asosiy mazmunga o‘tish</a>
      <PublicSite/>
      <AuthModal/>
      <Cabinet/>
      <ContentModal/>
      <AiChat/>
      <Toast/>
    </>
  );
}
