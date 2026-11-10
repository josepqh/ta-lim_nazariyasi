import { House, Layers, LogIn, Mail, Menu, Moon, Newspaper, Sun, UserPlus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { AccountMenu } from '../components/AccountMenu';
import { Logo } from '../components/Logo';
import { openAuth, showSection, toggleTheme, useApp, type PublicSection } from '../store';

const LINK = 'flex h-12 items-center gap-3 rounded-lg px-3 text-base font-medium text-ink transition-colors hover:bg-primary/10 hover:text-primary xl:h-10 xl:gap-2 xl:text-[15px]';

export function Navbar() {
  const user = useApp((state) => state.user);
  const theme = useApp((state) => state.theme);
  const [menuOpen, setMenuOpen] = useState(false);

  function go(section: PublicSection) {
    setMenuOpen(false);
    showSection(section);
  }

  const link = (section: PublicSection, icon: ReactNode, label: string) => (
    <li><a href="#" className={LINK} onClick={(event) => { event.preventDefault(); go(section); }}>{icon} {label}</a></li>
  );
  const themeIcon = theme === 'dark' ? <Sun/> : <Moon/>;
  const themeLabel = theme === 'dark' ? 'Kunduzgi rejim' : 'Tungi rejim';

  return (
    <nav id="navbar" className="fixed inset-x-0 top-0 z-[900] flex h-16 items-center border-b border-line bg-overlay backdrop-blur xl:h-[76px]">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6 xl:gap-6 xl:px-8">
        <a href="#" id="navBrand" className="mr-auto inline-flex min-w-0 items-center gap-2.5 xl:mr-0 xl:flex-1" onClick={(event) => { event.preventDefault(); go('home'); }}>
          <Logo size={40} wordmarkClass={user ? undefined : 'max-[459px]:sr-only'}/>
        </a>
        <button id="mobileMenuBtn" className="icon-btn order-3 border-transparent xl:hidden" type="button" aria-label={menuOpen ? 'Menyuni yopish' : 'Menyuni ochish'}
          aria-expanded={menuOpen} aria-controls="mainNav" onClick={() => setMenuOpen((value) => !value)}>
          {menuOpen ? <X className="size-[22px]"/> : <Menu className="size-[22px]"/>}
        </button>
        <ul id="mainNav" className={`absolute inset-x-0 top-full hidden flex-col gap-1 border-b border-line bg-surface px-4 py-3 shadow-lg sm:px-6 [&.open]:flex xl:static xl:flex xl:flex-row xl:items-center xl:gap-1 xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none${menuOpen ? ' open' : ''}`}>
          {link('home', <House className="size-[18px]"/>, 'Bosh sahifa')}
          {link('public-modules', <Layers className="size-[18px]"/>, 'Modullar')}
          {link('public-news', <Newspaper className="size-[18px]"/>, 'Maqolalar')}
          {link('public-contact', <Mail className="size-[18px]"/>, 'Aloqa')}
          {!user && (
            <li className="sm:hidden"><button type="button" className={`theme-menu-item w-full ${LINK}`} onClick={toggleTheme}>{themeIcon} {themeLabel}</button></li>
          )}
        </ul>
        {user ? (
          <div id="navUser" className="order-2 flex items-center gap-2 xl:flex-1 xl:justify-end">
            <AccountMenu place="site" triggerId="navUserName" menuId="navMenu"/>
          </div>
        ) : (
          <div id="navAuth" className="order-2 flex items-center gap-2 xl:flex-1 xl:justify-end">
            <button type="button" data-theme-toggle className="icon-btn hidden sm:inline-flex" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>{themeIcon}</button>
            <button type="button" id="navRegister" className="btn btn-line whitespace-nowrap max-sm:h-10 max-sm:px-3 max-sm:text-sm" onClick={() => openAuth('register')}>
              <UserPlus className="max-sm:hidden"/> Ro‘yxatdan o‘tish
            </button>
            <button type="button" id="navLogin" className="btn btn-solid whitespace-nowrap max-sm:h-10 max-sm:px-3 max-sm:text-sm" onClick={() => openAuth('login')}>
              <LogIn className="max-sm:hidden"/> Kirish
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
