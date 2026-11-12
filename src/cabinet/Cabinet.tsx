import { ArrowLeft, BarChart3, BookOpen, ChevronRight, ClipboardCheck, LayoutDashboard, Menu, Newspaper, ScrollText, UsersRound, Users, type LucideIcon } from 'lucide-react';
import { Suspense, lazy, useEffect, useRef } from 'react';
import { AccountMenu } from '../components/AccountMenu';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Logo } from '../components/Logo';
import { PageSkeleton } from '../components/Skeleton';
import { prefetchPage } from '../lib/prefetch';
import { cx } from '../lib/format';
import { useModules } from '../lib/queries';
import { navigate, returnToWebsite, useApp, type PageId } from '../store';
import type { Role } from '../types';
import { Dashboard } from './pages/Dashboard';
import { Lesson } from './pages/Lesson';
import { ManageModules } from './pages/ManageModules';
import { Modules } from './pages/Modules';
import { MyProfile } from './pages/MyProfile';
import { StudentDetail, Submissions } from './pages/Submissions';
import { ArticlesAdmin } from './pages/Articles';
import { Groups } from './pages/Groups';
import { Logs, UserProfile, UsersPage } from './pages/Users';

// Charts are the heaviest dependency and only staff open them.
const Analytics = lazy(() => import('./pages/Analytics'));

interface MenuItem {
  id: PageId;
  title: string;
  short?: string;
  icon: LucideIcon;
}

const STAFF_MENU: MenuItem[] = [
  { id: 'home', title: 'Boshqaruv paneli', short: 'Panel', icon: LayoutDashboard },
  { id: 'modules', title: 'Modullar', icon: BookOpen },
  { id: 'groups', title: 'Guruhlar', icon: UsersRound },
  { id: 'analytics', title: 'Tahlil va grafika', icon: BarChart3 },
  { id: 'submissions', title: 'Talaba javoblari', short: 'Javoblar', icon: ClipboardCheck }
];
export const NAV_MENU: Record<Role, MenuItem[]> = {
  student: [
    { id: 'home', title: 'Boshqaruv paneli', short: 'Panel', icon: LayoutDashboard },
    { id: 'modules', title: 'Modullar', icon: BookOpen }
  ],
  teacher: STAFF_MENU,
  admin: [
    ...STAFF_MENU,
    { id: 'users', title: 'Foydalanuvchilar', short: 'Ro‘yxat', icon: Users },
    { id: 'articles', title: 'Maqolalar', icon: Newspaper },
    { id: 'errors', title: 'Jurnallar', icon: ScrollText }
  ]
};

const FIXED_TITLES: Partial<Record<PageId, string>> = {
  'manage-modules': 'Modullar',
  'student-detail': 'Talaba ishlari',
  'user-profile': 'Profil',
  profile: 'Profilim'
};

function activeMenuId(page: PageId): PageId {
  if (page === 'module-view' || page === 'manage-modules') return 'modules';
  if (page === 'student-detail') return 'analytics';
  if (page === 'user-profile') return 'users';
  return page;
}

function Page() {
  const page = useApp((state) => state.page);
  const routeId = useApp((state) => state.routeId);
  switch (page) {
    case 'home': return <Dashboard/>;
    case 'modules': return <Modules/>;
    case 'module-view': return <Lesson key={routeId} moduleId={routeId}/>;
    case 'manage-modules': return <ManageModules/>;
    case 'analytics': return <Suspense fallback={<PageSkeleton/>}><Analytics/></Suspense>;
    case 'submissions': return <Submissions/>;
    case 'student-detail': return <StudentDetail studentId={routeId}/>;
    case 'users': return <UsersPage/>;
    case 'user-profile': return <UserProfile profileId={routeId}/>;
    case 'profile': return <MyProfile/>;
    case 'errors': return <Logs/>;
    case 'groups': return <Groups/>;
    case 'articles': return <ArticlesAdmin/>;
    default: return <div className="card">Sahifa topilmadi.</div>;
  }
}

export function Cabinet() {
  const user = useApp((state) => state.user);
  const view = useApp((state) => state.view);
  const page = useApp((state) => state.page);
  const routeId = useApp((state) => state.routeId);
  const titleOverride = useApp((state) => state.titleOverride);
  const sidebarOpen = useApp((state) => state.sidebarOpen);
  const navKey = useApp((state) => state.navKey);
  const modules = useModules();
  const container = useRef<HTMLDivElement>(null);
  const active = view === 'cabinet' && Boolean(user);
  const inLesson = page === 'module-view';

  useEffect(() => {
    container.current?.scrollTo(0, 0);
  }, [page, routeId]);

  const menu = user ? NAV_MENU[user.role] : [];
  const lessonTitle = modules.data?.find((module) => Number(module.id) === Number(routeId))?.title;
  const title = titleOverride
    ?? (inLesson ? lessonTitle ?? 'Modul' : FIXED_TITLES[page] ?? menu.find((item) => item.id === page)?.title ?? 'Boshqaruv paneli');
  const menuId = activeMenuId(page);
  const toggleSidebar = () => useApp.setState({ sidebarOpen: !sidebarOpen });

  return (
    <div id="screen-app" className={cx('screen hidden h-dvh w-full overflow-hidden bg-page text-base leading-normal [&.active]:flex', active && 'active')}>
      {active && user && (
        <>
          <div id="sidebarBackdrop" className={cx('fixed inset-0 z-[840] hidden bg-black/40 [&.active]:block lg:[&.active]:hidden', sidebarOpen && 'active')} onClick={toggleSidebar}/>
          <aside id="sidebar" className={cx('fixed inset-y-0 left-0 z-[850] flex h-full w-64 shrink-0 -translate-x-full flex-col border-r border-line bg-surface transition-transform duration-300 lg:static lg:translate-x-0 [&.open]:translate-x-0', sidebarOpen && 'open')}>
            <button type="button" className="sidebar-logo flex h-16 shrink-0 cursor-pointer items-center gap-3 px-5 text-left" onClick={returnToWebsite} aria-label="Saytning bosh sahifasiga qaytish">
              <Logo size={36}/>
            </button>
            <nav id="sidebarNav" className="flex-1 space-y-1 overflow-y-auto p-3">
              {menu.map((item) => (
                <button key={item.id} type="button" id={`nav-${item.id}`} className={cx('nav-item', menuId === item.id && 'active')} aria-current={menuId === item.id ? 'page' : undefined}
                  onPointerEnter={() => prefetchPage(item.id)} onFocus={() => prefetchPage(item.id)} onClick={() => navigate(item.id)}>
                  <item.icon/> <span>{item.title}</span>
                </button>
              ))}
            </nav>
          </aside>

          <main id="mainContent" tabIndex={-1} className="flex h-full min-w-0 flex-1 flex-col overflow-hidden outline-none">
            <div className={cx('topbar flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 sm:px-6 lg:py-0', inLesson && 'in-lesson')}>
              <div className="flex min-w-0 items-center gap-2">
                <button type="button" className="icon-btn border-0 lg:hidden in-[.in-lesson]:hidden" onClick={toggleSidebar} aria-label="Menyu"><Menu className="size-5"/></button>
                <button type="button" className="icon-btn hidden border-0 in-[.in-lesson]:inline-flex lg:in-[.in-lesson]:hidden" onClick={() => navigate('modules')} aria-label="Modullarga qaytish"><ArrowLeft className="size-5"/></button>
                <button type="button" className="hidden items-center gap-2 text-[15px] font-medium text-muted transition-colors hover:text-primary lg:in-[.in-lesson]:inline-flex" onClick={() => navigate('modules')}>Modullar <ChevronRight/></button>
                <h1 id="pageTitle" className="min-w-0 text-base leading-tight font-semibold tracking-tight wrap-anywhere text-ink sm:text-xl">{title}</h1>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" className="btn btn-line hidden sm:inline-flex" onClick={returnToWebsite}><ArrowLeft/> Saytga qaytish</button>
                <AccountMenu place="app" triggerId="topbarUser" menuId="topbarMenu"/>
              </div>
            </div>
            <div ref={container} id="pageContainer" className={cx('min-h-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 lg:pb-6', inLesson && 'lesson-mode')}>
              <ErrorBoundary key={navKey}><Page/></ErrorBoundary>
            </div>
            <nav id="mobileBottomNav" className="fixed inset-x-0 bottom-0 z-[800] flex h-[calc(4rem+env(safe-area-inset-bottom))] items-center justify-around border-t border-line bg-surface px-1.5 pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Mobil pastki menyu">
              {/* Four places fit a thumb's reach; the rest live in the side menu behind "Yana". */}
              {menu.slice(0, menu.length > 5 ? 4 : 5).map((item) => (
                <button key={item.id} type="button" id={`bnav-${item.id}`} className={cx('bottom-nav-item', menuId === item.id && 'active')} aria-label={item.title} onTouchStart={() => prefetchPage(item.id)} onClick={() => navigate(item.id)}>
                  <item.icon/> <span>{item.short || item.title.split(' ')[0]}</span>
                </button>
              ))}
              {menu.length > 5 && (
                <button type="button" id="bnav-more" className={cx('bottom-nav-item', menu.slice(4).some((item) => item.id === menuId) && 'active')} aria-label="Boshqa bo‘limlar" onClick={toggleSidebar}>
                  <Menu/> <span>Yana</span>
                </button>
              )}
            </nav>
          </main>
        </>
      )}
    </div>
  );
}
