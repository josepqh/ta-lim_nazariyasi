import { ArrowRight, BarChart2, Camera, Check, CircleArrowRight, GraduationCap, LayoutDashboard, Library, Mail, MapPin, MonitorPlay, Phone, PlayCircle, Send, Sparkles, Users } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { Logo } from '../components/Logo';
import { Lesson } from '../cabinet/pages/Lesson';
import { cx } from '../lib/format';
import { useModules, useMyProgress } from '../lib/queries';
import { navigate, openAuth, openModule, showSection, useApp, type PublicSection } from '../store';
import { Navbar } from './Navbar';
import { Privacy, Terms } from './Legal';

const GUIDES = [
  { title: 'Darsni rejalashtirish', desc: 'Aniq o‘quv maqsadini belgilang, mazmun va mashqlarni shu maqsadga moslang.' },
  { title: 'Faol o‘rganish', desc: 'Savol, bahs-munozara va amaliy mashqlar orqali o‘quvchini dars jarayoniga jalb qiling.' },
  { title: 'O‘quv natijalarini baholash', desc: 'Baholash mezonlarini oldindan tushuntiring va natijaga konstruktiv fikr-mulohaza qo‘shing.' },
  { title: 'Refleksiya va o‘z-o‘zini rivojlantirish', desc: 'Darsdan keyin nimalar samarali ishlaganini ko‘rib chiqing va keyingi mashg‘ulotni shunga qarab boyiting.' }
];

function Section({ id, children }: { id: PublicSection; children: ReactNode }) {
  const active = useApp((state) => state.section === id);
  return (
    <section id={id} className={cx('public-section hidden animate-fade-in pt-16 xl:pt-[76px] [&.active]:block', active && 'active')}>
      {active ? children : null}
    </section>
  );
}

function Heading({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center lg:mb-14">
      <span className="section-eyebrow">{eyebrow}</span>
      <h2 className="section-heading">{title}</h2>
      {text && <p className="mt-3 text-base leading-relaxed text-muted sm:text-lg">{text}</p>}
    </div>
  );
}

function Home() {
  const user = useApp((state) => state.user);
  const join = () => openAuth('register');
  const ticks = ['Ilmiy asoslangan metodologiya', 'Bosqichma-bosqich o‘quv jarayoni', 'O‘zlashtirish jarayoni saqlanadi', 'O‘qituvchi qo‘shgan materiallar'];
  const features = [
    { icon: <GraduationCap className="size-6"/>, title: 'O‘qituvchilar uchun', text: 'Modullarni boshqaring, video va matnli materiallar qo‘shing, talabalar topshiriqlarini tekshiring.' },
    { icon: <Users className="size-6"/>, title: 'Talabalar uchun', text: 'Modullarni ketma-ket o‘rganing, savollarga javob bering va o‘zlashtirish jarayonini kuzating.' },
    { icon: <MonitorPlay className="size-6"/>, title: 'Online kurslar', text: 'O‘qituvchi kiritgan video darslar, taqdimotlar va amaliy topshiriqlar majmuasi.' },
    { icon: <BarChart2 className="size-6"/>, title: 'Grafik tahlillar', text: 'Test natijalari, bajarilgan qadamlar va reytinglar interaktiv grafiklarda aks etadi.' }
  ];
  return (
    <>
      <div className="relative -mt-16 flex min-h-svh items-center justify-center px-5 pt-16 pb-10 text-center xl:-mt-[76px] xl:pt-[76px]">
        <div className="hero-photo absolute inset-0 bg-cover bg-center"/>
        <div className="absolute inset-0 bg-gradient-to-b from-[#16110b]/75 via-[#16110b]/60 to-[#16110b]/85"/>
        <div className="relative z-10 w-full max-w-3xl">
          <h1 className="text-4xl leading-[1.1] font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">Ta'limning ilg‘or<br/><span className="text-[#E3C79B]">usullarini</span><br/>kashf eting</h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">Ta'lim nazariyasini o‘rganish, o‘quv materiallari bilan ishlash va bilimni amaliyotda sinash uchun zamonaviy platforma.</p>
          <div className="mx-auto mt-8 grid max-w-sm gap-3 sm:max-w-xl sm:grid-cols-2">
            <button type="button" id="heroJoin" className="btn btn-solid min-h-13 w-full" onClick={join}>
              {user ? <><LayoutDashboard className="size-5"/> Boshqaruv paneliga o‘tish</> : <><CircleArrowRight className="size-5"/> Platformaga qo‘shilish</>}
            </button>
            <button type="button" id="heroModules" className="btn btn-on-photo min-h-13 w-full" onClick={() => showSection('public-modules')}>
              <Library className="size-5"/> Modullar bilan tanishish
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-6xl grid-cols-2 lg:grid-cols-4">
          {[['6', 'Har bir moduldagi qadam'], ['3', 'Foydalanuvchi roli'], ['1', 'Yagona platforma'], ['O‘z', 'sur\'atingizda o‘rganing']].map(([value, label]) => (
            <div key={label} className="px-4 py-7 text-center lg:py-10 lg:not-first:border-l lg:not-first:border-line">
              <span className="block text-3xl font-bold text-ink lg:text-4xl">{value}</span>
              <span className="mt-1 block text-sm text-muted sm:text-base">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="page-section bg-page">
        <div className="page-container grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <img src="/images/about_team.jpg" alt="Ta'lim nazariyasi — dars jarayoni va birgalikda o‘rganish" loading="lazy" width={512} height={512} className="h-64 w-full rounded-2xl border border-line object-cover shadow-xl sm:h-96 lg:h-[480px]"/>
          <div>
            <span className="section-eyebrow">Biz haqimizda</span>
            <h2 className="section-heading">Ta'lim nazariyasi nima?</h2>
            <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">Ta'lim nazariyasi (didaktika) &mdash; bu ta'lim jarayonining qonuniyatlari, tamoyillari, usullari va shakllarini o‘rganuvchi fan. U ta'lim-tarbiya jarayonini eng samarali tashkil etish yo‘llarini taklif etadi.</p>
            <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">Bizning platformamiz orqali siz ta'lim nazariyasining asosiy tamoyillarini o‘rganasiz va ularni amalda qo‘llashni o‘zlashtirasiz.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {ticks.map((tick) => (
                <div key={tick} className="flex items-center gap-2.5 text-base text-ink"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><Check className="size-3.5"/></span> {tick}</div>
              ))}
            </div>
            <button type="button" className="btn btn-solid mt-8 w-full sm:w-auto" onClick={join}>Boshlash <ArrowRight/></button>
          </div>
        </div>
      </div>

      <div id="features" className="page-section bg-surface">
        <div className="page-container">
          <Heading eyebrow="Xizmatlarimiz" title="Nima taklif etamiz?" text="Talabalar bilimni o‘rganadi, o‘qituvchilar esa kurs materiallari, grafik tahlillar va javoblarni boshqaradi."/>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <div key={feature.title} className="rounded-2xl border border-line bg-page p-6 transition duration-200 hover:-translate-y-1 hover:border-primary hover:shadow-lg lg:p-7">
                <div className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">{feature.icon}</div>
                <h3 className="mt-4 text-xl font-semibold text-ink">{feature.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-muted">{feature.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-primary px-5 py-14 text-center lg:py-20">
        <p className="mx-auto max-w-3xl text-2xl leading-snug font-semibold text-on-primary sm:text-3xl lg:text-4xl">Ta'lim inson kamolotiga yo‘l ochadi.</p>
      </div>
    </>
  );
}

function PublicModules() {
  const user = useApp((state) => state.user);
  const modules = useModules();
  const progress = useMyProgress();
  const isStudent = user?.role === 'student';

  function open(id: number) {
    if (user) openModule(id);
    else {
      useApp.setState({ publicModuleId: id });
      showSection('public-module-view');
    }
  }

  const list = modules.data ?? [];
  return (
    <div className="page-container page-section">
      <Heading eyebrow="O‘quv dasturi" title="Ta'lim Nazariyasi modullari" text="Har bir modul nazariy va amaliy qismlarni o‘z ichiga oladi. O‘quv jarayoni bosqichma-bosqich tashkil etilgan."/>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" id="publicModulesList">
        {modules.isLoading && <div className="spinner col-span-full"/>}
        {modules.isSuccess && !list.length && <p className="col-span-full text-center text-base text-muted">Hozircha modullar qo‘shilmagan.</p>}
        {list.map((module) => {
          const steps = progress.data?.[module.id]?.completed_steps.length ?? 0;
          const pct = Math.round((steps / 6) * 100);
          return (
            <div key={module.id} className="info-tile flex flex-col">
              <span className="section-eyebrow">Modul {Number(module.order_num)}</span>
              <h3 className="mt-2 text-xl font-semibold text-ink">{module.title}</h3>
              <p className="mt-2 flex-1 text-base leading-relaxed text-muted">{module.description || "Ta'lim nazariyasi moduli"}</p>
              {isStudent && (
                <div className="mt-4">
                  <div className="flex justify-between text-sm font-medium text-ink"><span>{steps >= 6 ? 'Tamomlandi' : `${steps}/6 qadam`}</span><span>{pct}%</span></div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${steps >= 6 ? 'bg-success' : 'bg-primary'}`} style={{ width: `${pct}%` }}/></div>
                </div>
              )}
              <button type="button" className="btn btn-line mt-5 self-start" onClick={() => open(module.id)}>Modulni o‘rganish <ArrowRight/></button>
            </div>
          );
        })}
        {modules.isSuccess && !user && (
          <button type="button" className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/5 p-6 text-center sm:p-7" onClick={() => openAuth('register')}>
            <GraduationCap className="size-9 text-primary"/>
            <span className="mt-3 text-xl font-semibold text-ink">Barcha modullarga kirish</span>
            <span className="mt-1 text-base text-muted">Bepul ro‘yxatdan o‘tib, darslarni o‘zlashtirishni boshlang</span>
            <span className="btn btn-solid mt-4"><Sparkles/> Ro‘yxatdan o‘tish</span>
          </button>
        )}
      </div>
    </div>
  );
}

function Contact() {
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') || '').trim();
    const subject = encodeURIComponent(`Ta'lim Nazariyasi murojaat: ${name}`);
    const body = encodeURIComponent(`${String(data.get('message') || '').trim()}\n\nYuboruvchi: ${name}\nEmail: ${String(data.get('email') || '').trim()}`);
    window.location.href = `mailto:info@talimnazariyasi.uz?subject=${subject}&body=${body}`;
  }
  return (
    <div className="page-container page-section">
      <Heading eyebrow="Aloqa" title="Biz bilan bog‘laning"/>
      <div className="grid overflow-hidden rounded-2xl border border-line bg-surface lg:grid-cols-5">
        <div className="flex flex-col justify-center gap-5 bg-primary p-7 text-base text-on-primary sm:p-10 lg:col-span-2">
          <p className="flex items-center gap-3"><MapPin className="size-5"/> Toshkent sh., Mirzo Ulug‘bek ko‘chasi, 45-uy</p>
          <p className="flex items-center gap-3"><Phone className="size-5"/> +998 90 123 45 67</p>
          <p className="flex items-center gap-3"><Mail className="size-5"/> info@talimnazariyasi.uz</p>
        </div>
        <form className="flex flex-col gap-4 p-6 sm:p-10 lg:col-span-3" onSubmit={send}>
          <label htmlFor="contactName" className="sr-only">Ismingiz</label>
          <input type="text" id="contactName" name="name" className="field" placeholder="Ismingiz" autoComplete="name" required/>
          <label htmlFor="contactEmail" className="sr-only">Emailingiz</label>
          <input type="email" id="contactEmail" name="email" className="field" placeholder="Emailingiz" autoComplete="email" required/>
          <label htmlFor="contactMessage" className="sr-only">Xabaringiz</label>
          <textarea id="contactMessage" name="message" className="field" rows={4} placeholder="Xabaringiz..." required/>
          <button type="submit" className="btn btn-solid self-start"><Send/> Email orqali yuborish</button>
        </form>
      </div>
    </div>
  );
}

function Footer() {
  const user = useApp((state) => state.user);
  const go = (section: PublicSection) => (event: { preventDefault(): void }) => { event.preventDefault(); showSection(section); };
  const toFeatures = (event: { preventDefault(): void }) => {
    event.preventDefault();
    showSection('home');
    requestAnimationFrame(() => document.getElementById('features')?.scrollIntoView());
  };
  // Social accounts are not open yet; the links stay inert until their addresses exist.
  const soon = (event: { preventDefault(): void }) => event.preventDefault();
  return (
    <footer className="site-footer bg-[#1F1A15] text-[#D9CFC2]">
      <div className="mx-auto max-w-7xl px-4 pt-14 pb-8 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <a href="#" className="inline-flex items-center gap-3" onClick={go('home')}><Logo size={40} tone="onDark"/></a>
            <p className="mt-5 text-[15px] leading-relaxed text-[#B8AC9C]">Pedagogika va ta'lim nazariyasini olti qadamli modullar orqali o‘rganish, materiallar bilan ishlash va bilimni amalda sinash uchun platforma.</p>
          </div>
          <nav aria-labelledby="footerPlatform">
            <h2 id="footerPlatform" className="footer-heading">Platforma</h2>
            <ul className="footer-links">
              <li><a href="#public-modules" onClick={go('public-modules')}>Modullar</a></li>
              <li><a href="#public-news" onClick={go('public-news')}>Maqolalar</a></li>
              <li><a href="#" onClick={toFeatures}>O‘qituvchilar uchun</a></li>
              <li><a href="#" onClick={user ? (event) => { event.preventDefault(); navigate('home'); } : (event) => { event.preventDefault(); openAuth('register'); }}>Talabalar uchun</a></li>
            </ul>
          </nav>
          <nav aria-labelledby="footerHelp">
            <h2 id="footerHelp" className="footer-heading">Yordam</h2>
            <ul className="footer-links">
              <li><a href="#public-news" onClick={go('public-news')}>Foydalanish bo‘yicha tavsiyalar</a></li>
              <li><a href="#privacy" onClick={go('privacy')}>Maxfiylik siyosati</a></li>
              <li><a href="#public-contact" onClick={go('public-contact')}>Aloqa</a></li>
            </ul>
          </nav>
          <nav aria-labelledby="footerSocial">
            <h2 id="footerSocial" className="footer-heading">Ijtimoiy tarmoqlar</h2>
            <ul className="footer-links">
              <li><a href="#" onClick={soon}><Send/> Telegram</a></li>
              <li><a href="#" onClick={soon}><PlayCircle/> YouTube</a></li>
              <li><a href="#" onClick={soon}><Camera/> Instagram</a></li>
            </ul>
          </nav>
        </div>
        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-6 text-sm text-[#A39886] sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Ta'lim Nazariyasi. Barcha huquqlar himoyalangan.</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            <li><a href="#privacy" className="footer-sub" onClick={go('privacy')}>Maxfiylik siyosati</a></li>
            <li><a href="#terms" className="footer-sub" onClick={go('terms')}>Foydalanish shartlari</a></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

export function PublicSite() {
  const view = useApp((state) => state.view);
  const user = useApp((state) => state.user);
  const publicModuleId = useApp((state) => state.publicModuleId);
  const hidden = view === 'cabinet' && Boolean(user);
  return (
    <div id="public-website" className="min-h-screen" style={hidden ? { display: 'none' } : undefined}>
      <Navbar/>
      <main>
        <Section id="home"><Home/></Section>
        <Section id="public-modules"><PublicModules/></Section>
        <Section id="public-module-view"><div className="page-container page-section" id="publicModuleViewContainer"><Lesson moduleId={publicModuleId} isPublic/></div></Section>
        <Section id="public-news">
          <div className="page-container page-section">
            <Heading eyebrow="Foydali mavzular" title="O‘qitish va o‘rganish bo‘yicha tavsiyalar"/>
            <div className="grid gap-5 sm:grid-cols-2" id="publicNewsList">
              {GUIDES.map((guide) => (
                <div key={guide.title} className="info-tile">
                  <h3 className="text-xl font-semibold text-ink">{guide.title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-muted">{guide.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </Section>
        <Section id="public-contact"><Contact/></Section>
        <Section id="privacy"><Privacy/></Section>
        <Section id="terms"><Terms/></Section>
      </main>
      <Footer/>
    </div>
  );
}
