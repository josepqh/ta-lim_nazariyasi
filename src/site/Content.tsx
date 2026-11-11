import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarDays, SearchCheck, ShieldAlert } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Markdown } from '../components/Markdown';
import { api } from '../lib/api';
import { imageUrl, useArticles, useStats, uzDate } from '../lib/learning';
import { showSection, useApp } from '../store';
import type { Article } from '../types';

// The home page band of real numbers, refreshed from the database every few minutes.
export function StatsBar() {
  const stats = useStats();
  const items: [keyof NonNullable<typeof stats.data>, string][] = [
    ['modules', 'O‘quv modullari'],
    ['students', 'Ro‘yxatdan o‘tgan talabalar'],
    ['teachers', 'O‘qituvchilar'],
    ['certificates', 'Berilgan sertifikatlar']
  ];
  return (
    <div className="border-b border-line bg-surface" id="statsBar">
      <div className="mx-auto grid max-w-6xl grid-cols-2 lg:grid-cols-4">
        {items.map(([key, label]) => (
          <div key={key} className="px-4 py-7 text-center lg:py-10 lg:not-first:border-l lg:not-first:border-line">
            <span className="block text-3xl font-bold text-ink tabular-nums lg:text-4xl" data-stat={key}>
              {stats.data ? stats.data[key].toLocaleString('uz-UZ') : <span className="skeleton mx-auto block h-9 w-16"/>}
            </span>
            <span className="mt-1 block text-sm text-muted sm:text-base">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArticleCard({ article }: { article: Article }) {
  return (
    <button type="button" className="article-card" onClick={() => showSection('public-article', article.slug)}>
      {article.cover_image_id
        ? <img src={imageUrl(article.cover_image_id)!} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover"/>
        : <span className="article-placeholder" aria-hidden="true">{article.title.charAt(0)}</span>}
      <span className="flex flex-1 flex-col p-6">
        <span className="flex items-center gap-1.5 text-sm text-muted"><CalendarDays className="size-4"/> {uzDate(article.created_at)}</span>
        <span className="mt-2 text-xl font-semibold text-ink">{article.title}</span>
        <span className="mt-2 line-clamp-3 flex-1 text-base leading-relaxed text-muted">{article.excerpt}</span>
        <span className="mt-4 inline-flex items-center gap-1.5 font-semibold text-primary">O‘qish <ArrowRight className="size-4"/></span>
      </span>
    </button>
  );
}

export function ArticleList() {
  const articles = useArticles();
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" id="publicNewsList">
      {articles.isLoading && [0, 1, 2].map((n) => <div key={n} className="skeleton h-72 rounded-2xl"/>)}
      {articles.isSuccess && !articles.data.length && <p className="col-span-full text-center text-muted">Hozircha maqolalar yo‘q.</p>}
      {articles.data?.map((article) => <ArticleCard key={article.id} article={article}/>)}
    </div>
  );
}

export function ArticlePage() {
  const slug = useApp((state) => state.sectionParam);
  const article = useQuery({
    queryKey: ['articles', 'slug', slug],
    enabled: Boolean(slug),
    queryFn: () => api<Article>(`/articles?slug=${encodeURIComponent(slug!)}`)
  });
  // The tab title follows the article, so a shared link and the history read well.
  useEffect(() => {
    if (!article.data) return undefined;
    const previous = document.title;
    document.title = `${article.data.title} — Ta'lim Nazariyasi`;
    return () => { document.title = previous; };
  }, [article.data]);

  return (
    <article className="page-container page-section max-w-3xl" id="articlePage">
      <button type="button" className="back-btn" onClick={() => showSection('public-news')}><ArrowLeft/> Barcha maqolalar</button>
      {article.isLoading && <div className="space-y-4"><div className="skeleton h-10 w-3/4"/><div className="skeleton h-64"/></div>}
      {article.isError && <p className="text-muted">Maqola topilmadi yoki o‘chirilgan.</p>}
      {article.data && (
        <>
          <p className="flex items-center gap-1.5 text-sm text-muted"><CalendarDays className="size-4"/> {uzDate(article.data.created_at)}{article.data.author_name ? ` · ${article.data.author_name}` : ''}</p>
          <h1 className="mt-2 text-3xl leading-tight font-bold tracking-tight text-ink sm:text-4xl">{article.data.title}</h1>
          {article.data.cover_image_id && <img src={imageUrl(article.data.cover_image_id)!} alt="" className="mt-6 aspect-[16/9] w-full rounded-2xl object-cover"/>}
          <Markdown text={article.data.body ?? ''} className="prose-text article-body mt-6"/>
        </>
      )}
    </article>
  );
}

interface CheckResult {
  valid: boolean;
  student_name?: string;
  module_title?: string;
  score?: number;
  issued_at?: string;
}

// Anyone (an employer, a school) can confirm a certificate from its number or QR code.
export function VerifyPage() {
  const param = useApp((state) => state.sectionParam);
  const [code, setCode] = useState(param ?? '');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function check(value: string) {
    setBusy(true);
    setError('');
    try {
      setResult(await api<CheckResult>(`/certificates?code=${encodeURIComponent(value.trim())}`));
    } catch (checkError) {
      setError((checkError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (param) {
      setCode(param);
      void check(param);
    }
  }, [param]);

  function submit(event: FormEvent) {
    event.preventDefault();
    showSection('verify', code.trim().toUpperCase());
  }

  return (
    <div className="page-container page-section max-w-2xl" id="verifyPage">
      <span className="section-eyebrow">Sertifikat</span>
      <h1 className="section-heading">Sertifikatni tekshirish</h1>
      <p className="mt-3 text-base text-muted">Sertifikatdagi 10 belgili raqamni kiriting yoki QR kodni telefon kamerasi bilan skanerlang.</p>
      <form className="mt-6 flex flex-wrap gap-2.5" onSubmit={submit}>
        <label htmlFor="verifyCode" className="sr-only">Sertifikat raqami</label>
        <input id="verifyCode" className="field min-w-56 flex-1 font-mono tracking-[0.2em] uppercase" placeholder="ABCD234EFG" maxLength={12} autoComplete="off" required value={code} onChange={(e) => setCode(e.target.value)}/>
        <button type="submit" className="btn btn-solid" disabled={busy}><SearchCheck/> Tekshirish</button>
      </form>
      {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
      {result && (result.valid ? (
        <div id="verifyResult" className="verify-result valid" role="status">
          <BadgeCheck className="size-8 text-primary"/>
          <div>
            <p className="text-lg font-semibold text-ink">Sertifikat haqiqiy</p>
            <p className="mt-1 text-ink"><strong>{result.student_name}</strong> «{result.module_title}» modulini tamomlagan.</p>
            <p className="mt-1 text-sm text-muted">Berilgan sana: {uzDate(result.issued_at!)} · {result.score} ball</p>
          </div>
        </div>
      ) : (
        <div id="verifyResult" className="verify-result invalid" role="status">
          <ShieldAlert className="size-8 text-danger"/>
          <div>
            <p className="text-lg font-semibold text-ink">Bunday sertifikat topilmadi</p>
            <p className="mt-1 text-sm text-muted">Raqam to‘g‘ri yozilganini tekshiring. Sertifikat Ta'lim Nazariyasi platformasida berilmagan bo‘lishi mumkin.</p>
          </div>
        </div>
      ))}
    </div>
  );
}
