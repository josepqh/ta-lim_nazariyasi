import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, EyeOff, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CoverPicker } from '../../components/CoverPicker';
import { RichTextEditor } from '../../components/RichTextEditor';
import { ListSkeleton } from '../../components/Skeleton';
import { api } from '../../lib/api';
import { useArticles, uzDate } from '../../lib/learning';
import { showToast } from '../../store';
import type { Article } from '../../types';

function Editor({ article, onDone }: { article: Article | null; onDone: () => void }) {
  const client = useQueryClient();
  const full = useQuery({
    queryKey: ['articles', 'edit', article?.slug],
    enabled: Boolean(article),
    queryFn: () => api<Article>(`/articles?slug=${encodeURIComponent(article!.slug)}`)
  });
  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [body, setBody] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [published, setPublished] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!full.data) return;
    setTitle(full.data.title);
    setExcerpt(full.data.excerpt);
    setBody(full.data.body ?? '');
    setCover(full.data.cover_image_id);
    setPublished(full.data.published);
  }, [full.data]);

  async function save() {
    setBusy(true);
    try {
      await api('/articles', 'POST', { id: article?.id, title, excerpt, body, cover_image_id: cover, published });
      await client.invalidateQueries({ queryKey: ['articles'] });
      showToast(published ? 'Maqola e’lon qilindi.' : 'Maqola qoralama sifatida saqlandi.', 'success');
      onDone();
    } catch (error) {
      showToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (article && full.isLoading) return <div className="card"><ListSkeleton/></div>;
  return (
    <>
      <button type="button" className="back-btn" onClick={onDone}><ArrowLeft/> Maqolalar ro‘yxatiga qaytish</button>
      <div className="card">
        <h3 className="card-title">{article ? 'Maqolani tahrirlash' : 'Yangi maqola'}</h3>
        <div className="form-group">
          <label htmlFor="articleTitle">Sarlavha</label>
          <input id="articleTitle" maxLength={200} placeholder="Masalan: Darsda faol o‘rganish usullari" value={title} onChange={(e) => setTitle(e.target.value)}/>
        </div>
        <div className="form-group">
          <label htmlFor="articleExcerpt">Qisqa tavsif <span className="text-muted">(ixtiyoriy, ro‘yxat va Google uchun)</span></label>
          <input id="articleExcerpt" maxLength={300} value={excerpt} onChange={(e) => setExcerpt(e.target.value)}/>
        </div>
        <div className="form-group">
          <span className="form-label">Muqova</span>
          <CoverPicker value={cover} onChange={setCover}/>
        </div>
        <div className="form-group">
          <label htmlFor="articleBody">Maqola matni</label>
          <RichTextEditor id="articleBody" rows={14} maxLength={50000} value={body} onChange={setBody} placeholder="Maqola matnini yozing. Sarlavha, ro‘yxat va havolalar uchun yuqoridagi tugmalardan foydalaning."/>
        </div>
        <label className="mb-5 flex items-center gap-2.5 text-[15px]"><input type="checkbox" id="articlePublished" className="size-4 accent-[var(--primary)]" checked={published} onChange={(e) => setPublished(e.target.checked)}/> Saytda e’lon qilish (belgilanmasa qoralama bo‘lib qoladi)</label>
        <button type="button" className="btn-primary" id="articleSave" disabled={busy} onClick={save}><Save/> {busy ? 'Saqlanmoqda…' : 'Saqlash'}</button>
      </div>
    </>
  );
}

export function ArticlesAdmin() {
  const articles = useArticles(true);
  const client = useQueryClient();
  const [editing, setEditing] = useState<Article | 'new' | null>(null);

  async function remove(article: Article) {
    if (!window.confirm(`“${article.title}” maqolasi o‘chirilsinmi?`)) return;
    try {
      await api(`/articles?id=${article.id}`, 'DELETE');
      await client.invalidateQueries({ queryKey: ['articles'] });
      showToast('Maqola o‘chirildi.', 'info');
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  }

  if (editing) return <Editor article={editing === 'new' ? null : editing} onDone={() => setEditing(null)}/>;
  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="card-title m-0">Saytdagi maqolalar</h3>
        <button type="button" className="btn-primary" id="newArticle" onClick={() => setEditing('new')}><Plus/> Yangi maqola</button>
      </div>
      {articles.isLoading && <ListSkeleton/>}
      <ul className="divide-y divide-line">
        {articles.data?.map((article) => (
          <li key={article.id} className="flex flex-wrap items-center gap-3 py-3.5 sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <p className="font-semibold wrap-anywhere text-ink">{article.title}</p>
              <p className="text-sm text-muted">{uzDate(article.created_at)} · {article.published ? <span className="inline-flex items-center gap-1"><Eye className="size-3.5"/> E’lon qilingan</span> : <span className="inline-flex items-center gap-1 text-danger"><EyeOff className="size-3.5"/> Qoralama</span>}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-outline btn-sm" onClick={() => setEditing(article)}><Pencil/> Tahrirlash</button>
              <button type="button" className="btn-danger btn-sm" onClick={() => remove(article)}><Trash2/> O‘chirish</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
