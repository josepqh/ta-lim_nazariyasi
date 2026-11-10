import { ChevronDown, GraduationCap, LayoutDashboard, LogOut, Moon, Shield, Sun, User as UserIcon, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ROLE_LABELS, initialOf } from '../lib/format';
import { logout } from '../session';
import { navigate, toggleTheme, useApp } from '../store';

const ROLE_ICONS = { student: UserIcon, teacher: GraduationCap, admin: Shield };

interface Props {
  place: 'app' | 'site';
  triggerId: string;
  menuId: string;
}

// The role chip (cabinet) and the name chip (public site) open the same menu.
export function AccountMenu({ place, triggerId, menuId }: Props) {
  const user = useApp((state) => state.user);
  const theme = useApp((state) => state.theme);
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function onOutside(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, [open]);

  if (!user) return null;
  const name = user.name || user.login;
  const role = ROLE_LABELS[user.role] || ROLE_LABELS.admin;
  const RoleIcon = ROLE_ICONS[user.role] || Shield;

  function close(returnFocus = false) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      items[(moves[event.key]! + items.length) % items.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close();
    }
  }

  const item = (icon: ReactNode, label: string, onClick: () => void, danger = false, extra = '') => (
    <button type="button" role="menuitem" tabIndex={-1} className={`account-item${danger ? ' account-item-danger' : ''}${extra}`} onClick={onClick}>
      {icon} {label}
    </button>
  );
  const themeItem = (
    <button type="button" role="menuitem" tabIndex={-1} className="account-item theme-menu-item" onClick={toggleTheme}>
      {theme === 'dark' ? <><Sun/> Kunduzgi rejim</> : <><Moon/> Tungi rejim</>}
    </button>
  );

  return (
    <div className="account" ref={wrapper}>
      <button
        ref={trigger}
        type="button"
        id={triggerId}
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${place === 'app' ? role : name}: hisob menyusi`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="account-avatar" aria-hidden="true">{initialOf(name)}</span>
        {place === 'app'
          ? <span className="hidden sm:inline">{role}</span>
          : <span className="hidden max-w-40 truncate sm:inline">{name}</span>}
        <ChevronDown aria-hidden="true"/>
      </button>
      <div ref={menu} id={menuId} className="account-menu" role="menu" aria-labelledby={triggerId} hidden={!open} onKeyDown={onMenuKey}>
        <div className="account-head" role="none">
          <span className="account-avatar size-10 text-base" aria-hidden="true">{initialOf(name)}</span>
          <div className="min-w-0">
            <p className="leading-snug font-semibold wrap-anywhere text-ink">{name}</p>
            <span className="account-role"><RoleIcon/> {role}</span>
          </div>
        </div>
        <div className="account-sep" role="separator"/>
        {place === 'site' && item(<LayoutDashboard/>, 'Boshqaruv paneli', () => { close(); navigate('home'); })}
        {item(<UserRound/>, 'Profilim', () => { close(); navigate('profile'); })}
        {themeItem}
        <div className="account-sep" role="separator"/>
        {item(<LogOut/>, 'Chiqish', () => { close(); void logout(); }, true)}
      </div>
    </div>
  );
}
