import { Check, Clock, GraduationCap, KeyRound, LogIn, Mail, Shield, User as UserIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import { ROLE_LABELS, cx } from '../lib/format';
import { startSession } from '../session';
import { closeAuth, showToast, useApp, type AuthView } from '../store';
import type { Role, User } from '../types';
import { useModal } from './useModal';

const VIEWS: Record<AuthView, { title: string; subtitle: string }> = {
  login: { title: 'Tizimga Kirish', subtitle: 'Platformadan foydalanish uchun o‘z rolingizni tanlang' },
  register: { title: 'Ro‘yxatdan o‘tish', subtitle: 'Rolingizni tanlang va Gmail manzilingizni kiriting' },
  registerCode: { title: 'Gmailni tasdiqlang', subtitle: '' },
  forgot: { title: 'Parolni tiklash', subtitle: 'Gmail manzilingizga tasdiqlash kodi yuboramiz' },
  forgotCode: { title: 'Yangi parol', subtitle: '' },
  pending: { title: 'So‘rovingiz yuborildi', subtitle: '' }
};

interface Registration {
  name: string;
  email: string;
  password: string;
  role: Role;
}

// Runs a form action with its button disabled and puts any error under the form.
function useSubmit(setError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  async function run(event: FormEvent, work: () => Promise<void>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await work();
    } catch (error) {
      setError((error as Error).message || 'Xatolik yuz berdi.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

function RoleTab({ role, active, onSelect, children }: { role: Role; active: boolean; onSelect: (role: Role) => void; children: ReactNode }) {
  return (
    <button type="button" className={cx('role-tab role-choice', active && 'active')} data-role={role} aria-pressed={active} onClick={() => onSelect(role)}>
      {children}
    </button>
  );
}

export function AuthModal() {
  const open = useApp((state) => state.authOpen);
  const view = useApp((state) => state.authView);
  const boxRef = useModal<HTMLDivElement>(open);
  const setView = (next: AuthView) => useApp.setState({ authView: next });

  const [subtitle, setSubtitle] = useState('');
  const [loginRole, setLoginRole] = useState<Role>('student');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [registerRole, setRegisterRole] = useState<Role>('student');
  const [regName, setRegName] = useState('');
  const [regLogin, setRegLogin] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regCode, setRegCode] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotPass, setForgotPass] = useState('');
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const pending = useRef<Registration | null>(null);
  const resetEmail = useRef('');
  const { busy, run } = useSubmit(setError);
  const codeRef = useRef<HTMLInputElement>(null);
  const forgotCodeRef = useRef<HTMLInputElement>(null);

  // Each view starts clean; a code view keeps the explanation it was opened with.
  useEffect(() => {
    setError('');
    if (view !== 'registerCode' && view !== 'forgotCode') setSubtitle('');
    if (view === 'registerCode') codeRef.current?.focus();
    if (view === 'forgotCode') forgotCodeRef.current?.focus();
  }, [view]);

  // After sign-out the forms start empty again.
  const signedIn = useApp((state) => Boolean(state.user));
  useEffect(() => {
    if (signedIn) return;
    setLoginPass('');
    setRegName('');
    setRegLogin('');
    setRegPass('');
    setRegisterRole('student');
  }, [signedIn]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const codeSent = (email: string) => `${email} manziliga 6 xonali kod yuborildi. Xat kelmasa, Spam papkasini tekshiring.`;

  const onLogin = (event: FormEvent) => run(event, async () => {
    const user = await api<User>('/auth', 'POST', { action: 'login', login: loginUser.trim(), password: loginPass });
    if (user.role !== loginRole) {
      await api('/auth', 'POST', { action: 'logout' });
      throw new Error(`Bu hisob "${ROLE_LABELS[user.role] || user.role}" roliga tegishli. Iltimos, to‘g‘ri rolni tanlang.`);
    }
    showToast(`Xush kelibsiz, ${user.name || user.login}!`, 'success');
    await startSession(user);
  });

  const onRegister = (event: FormEvent) => run(event, async () => {
    const registration = { name: regName.trim(), email: regLogin.trim(), password: regPass, role: registerRole };
    await api('/auth', 'POST', { action: 'register_start', ...registration });
    pending.current = registration;
    setRegCode('');
    setSubtitle(codeSent(registration.email));
    setView('registerCode');
    setCooldown(60);
  });

  async function resend() {
    setError('');
    try {
      await api('/auth', 'POST', { action: 'register_start', ...pending.current });
      showToast('Yangi kod yuborildi.', 'success');
      setCooldown(60);
    } catch (resendError) {
      setError((resendError as Error).message);
    }
  }

  const onRegisterCode = (event: FormEvent) => run(event, async () => {
    const result = await api<User & { pending?: boolean }>('/auth', 'POST', {
      action: 'register_verify', email: pending.current?.email, code: regCode.trim()
    });
    pending.current = null;
    setCooldown(0);
    if (result.pending) {
      setView('pending');
      return;
    }
    showToast('Ro‘yxatdan muvaffaqiyatli o‘tdingiz!', 'success');
    await startSession(result);
  });

  const onForgot = (event: FormEvent) => run(event, async () => {
    const email = forgotEmail.trim();
    await api('/auth', 'POST', { action: 'reset_start', email });
    resetEmail.current = email;
    setForgotCode('');
    setForgotPass('');
    setSubtitle(`Agar ${email} bilan hisob bo‘lsa, unga 6 xonali kod yuborildi.`);
    setView('forgotCode');
  });

  const onForgotCode = (event: FormEvent) => run(event, async () => {
    await api('/auth', 'POST', { action: 'reset_verify', email: resetEmail.current, code: forgotCode.trim(), password: forgotPass });
    setLoginUser(resetEmail.current);
    setLoginPass('');
    resetEmail.current = '';
    setView('login');
    showToast('Parol yangilandi. Endi kiring.', 'success');
  });

  const formClass = (name: AuthView) => cx('auth-form hidden animate-fade-in [&.active]:block', view === name && 'active');
  const errorBox = (id: string) => <div id={id} className="error-msg mb-3 min-h-5 text-sm text-danger" role="alert">{error}</div>;
  const submit = (label: ReactNode, busyLabel: string) => (
    <button type="submit" className="btn btn-solid w-full" disabled={busy}>{busy ? busyLabel : label}</button>
  );

  return (
    <div id="authModal" className={cx('modal-overlay modal-shell', open && 'active')} role="dialog" aria-modal="true" aria-labelledby="authTitle"
      onClick={(event) => { if (event.target === event.currentTarget) closeAuth(); }}>
      <div ref={boxRef} className="auth-card relative max-h-dvh w-full overflow-y-auto rounded-t-2xl border border-line bg-surface p-6 pb-8 text-center shadow-2xl sm:max-w-md sm:rounded-2xl sm:p-10">
        <button type="button" className="absolute top-3 right-3 grid size-11 place-items-center rounded-lg text-2xl text-muted transition-colors hover:text-ink" aria-label="Yopish" onClick={closeAuth}>&times;</button>

        <div className="mb-6 px-6 sm:mb-8">
          <h2 id="authTitle" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{VIEWS[view].title}</h2>
          {(subtitle || VIEWS[view].subtitle) && <p id="authSubtitle" className="mt-2 text-base text-muted">{subtitle || VIEWS[view].subtitle}</p>}
        </div>

        <form id="loginForm" className={formClass('login')} onSubmit={onLogin}>
          <div className="mb-5 grid grid-cols-3 gap-2">
            <RoleTab role="student" active={loginRole === 'student'} onSelect={setLoginRole}><UserIcon/> Talaba</RoleTab>
            <RoleTab role="teacher" active={loginRole === 'teacher'} onSelect={setLoginRole}><GraduationCap/> O‘qituvchi</RoleTab>
            <RoleTab role="admin" active={loginRole === 'admin'} onSelect={setLoginRole}><Shield/> Admin</RoleTab>
          </div>
          <div className="mb-4 text-left">
            <label htmlFor="loginUser" className="field-label">Gmail</label>
            <input type="text" id="loginUser" className="field" spellCheck={false} autoCapitalize="none" placeholder="nom@gmail.com" maxLength={254} autoComplete="username" required value={loginUser} onChange={(e) => setLoginUser(e.target.value)}/>
          </div>
          <div className="mb-4 text-left">
            <label htmlFor="loginPass" className="field-label">Parol</label>
            <input type="password" id="loginPass" className="field" placeholder="Parolni kiriting" maxLength={200} autoComplete="current-password" required value={loginPass} onChange={(e) => setLoginPass(e.target.value)}/>
          </div>
          {view === 'login' ? errorBox('loginError') : <div id="loginError" className="hidden"/>}
          {submit(<><LogIn/> Kirish</>, 'Kirilmoqda...')}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-base text-muted"><button type="button" className="text-link" onClick={() => setView('forgot')}>Parolni unutdingizmi?</button></div>
          <div className="mt-2 text-base text-muted">Hisobingiz yo‘qmi? <button type="button" className="text-link" onClick={() => setView('register')}>Ro‘yxatdan o‘tish</button></div>
        </form>

        <form id="registerForm" className={formClass('register')} onSubmit={onRegister}>
          <div className="mb-5 grid grid-cols-2 gap-2" role="group" aria-label="Rolni tanlang">
            <RoleTab role="student" active={registerRole === 'student'} onSelect={setRegisterRole}><UserIcon/> Talaba</RoleTab>
            <RoleTab role="teacher" active={registerRole === 'teacher'} onSelect={setRegisterRole}><GraduationCap/> O‘qituvchi</RoleTab>
          </div>
          {registerRole === 'teacher' && (
            <p className="mb-4 rounded-xl bg-primary/10 px-4 py-3 text-left text-sm text-ink">O‘qituvchi hisobini administrator tasdiqlaydi. Tasdiqlangach Gmail’ingizga xat keladi.</p>
          )}
          <div className="mb-4 text-left">
            <label htmlFor="regName" className="field-label">F.I.Sh (Familiya, Ism, Sharif)</label>
            <input type="text" id="regName" className="field" placeholder="To‘liq ismingiz" maxLength={100} autoComplete="name" required value={regName} onChange={(e) => setRegName(e.target.value)}/>
          </div>
          <div className="mb-4 text-left">
            <label htmlFor="regLogin" className="field-label">Gmail</label>
            <input type="email" id="regLogin" className="field" spellCheck={false} autoCapitalize="none" placeholder="nom@gmail.com" maxLength={254} autoComplete="email" required value={regLogin} onChange={(e) => setRegLogin(e.target.value)}/>
          </div>
          <div className="mb-4 text-left">
            <label htmlFor="regPass" className="field-label">Parol yaratish</label>
            <input type="password" id="regPass" className="field" placeholder="Kamida 10 belgi" minLength={10} maxLength={200} autoComplete="new-password" required value={regPass} onChange={(e) => setRegPass(e.target.value)}/>
          </div>
          {view === 'register' ? errorBox('registerError') : <div id="registerError" className="hidden"/>}
          {submit(<><Mail/> Kod yuborish</>, 'Yuborilmoqda…')}
          <div className="mt-5 text-base text-muted">Hisobingiz bormi? <button type="button" className="text-link" onClick={() => setView('login')}>Kirish</button></div>
        </form>

        <form id="registerCodeForm" className={formClass('registerCode')} onSubmit={onRegisterCode}>
          <div className="mb-4 text-left">
            <label htmlFor="regCode" className="field-label">Tasdiqlash kodi</label>
            <input ref={codeRef} type="text" id="regCode" className="field text-center text-2xl tracking-[0.5em] tabular-nums" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" placeholder="000000" required value={regCode} onChange={(e) => setRegCode(e.target.value)}/>
          </div>
          {view === 'registerCode' ? errorBox('registerCodeError') : <div id="registerCodeError" className="hidden"/>}
          {submit(<><Check/> Tasdiqlash</>, 'Tekshirilmoqda…')}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-base text-muted">
            <button type="button" className="text-link disabled:no-underline" id="regResend" disabled={cooldown > 0} onClick={resend}>
              {cooldown > 0 ? `Qayta yuborish (${cooldown})` : 'Kodni qayta yuborish'}
            </button>
            <button type="button" className="text-link" onClick={() => setView('register')}>Orqaga</button>
          </div>
        </form>

        <div id="registerPending" className={formClass('pending')}>
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Clock className="size-7"/></span>
          <p className="mt-4 text-base text-ink">Gmail tasdiqlandi. O‘qituvchi hisobingizni administrator tekshirib, tasdiqlaydi.</p>
          <p className="mt-2 text-base text-muted">Tasdiqlangach Gmail’ingizga xat keladi, shundan keyin shu Gmail va parol bilan kirasiz.</p>
          <button type="button" className="btn btn-solid mt-6 w-full" onClick={closeAuth}>Tushunarli</button>
        </div>

        <form id="forgotForm" className={formClass('forgot')} onSubmit={onForgot}>
          <div className="mb-4 text-left">
            <label htmlFor="forgotEmail" className="field-label">Gmail</label>
            <input type="email" id="forgotEmail" className="field" spellCheck={false} autoCapitalize="none" placeholder="nom@gmail.com" maxLength={254} autoComplete="email" required value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}/>
          </div>
          {view === 'forgot' ? errorBox('forgotError') : <div id="forgotError" className="hidden"/>}
          {submit(<><Mail/> Kod yuborish</>, 'Yuborilmoqda…')}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-base text-muted"><button type="button" className="text-link" onClick={() => setView('login')}>Kirishga qaytish</button></div>
        </form>

        <form id="forgotCodeForm" className={formClass('forgotCode')} onSubmit={onForgotCode}>
          <div className="mb-4 text-left">
            <label htmlFor="forgotCode" className="field-label">Tasdiqlash kodi</label>
            <input ref={forgotCodeRef} type="text" id="forgotCode" className="field text-center text-2xl tracking-[0.5em] tabular-nums" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" placeholder="000000" required value={forgotCode} onChange={(e) => setForgotCode(e.target.value)}/>
          </div>
          <div className="mb-4 text-left">
            <label htmlFor="forgotPass" className="field-label">Yangi parol</label>
            <input type="password" id="forgotPass" className="field" placeholder="Kamida 10 belgi" minLength={10} maxLength={200} autoComplete="new-password" required value={forgotPass} onChange={(e) => setForgotPass(e.target.value)}/>
          </div>
          {view === 'forgotCode' ? errorBox('forgotCodeError') : <div id="forgotCodeError" className="hidden"/>}
          {submit(<><KeyRound/> Parolni yangilash</>, 'Saqlanmoqda…')}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-base text-muted"><button type="button" className="text-link" onClick={() => setView('forgot')}>Orqaga</button></div>
        </form>
      </div>
    </div>
  );
}
