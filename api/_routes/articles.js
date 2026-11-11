const sql = require('../_db');
const { getSessionUser, requireUser } = require('../_auth');
const { audit } = require('../_audit');
const { reportServerError } = require('../_errors');
const { isUuid } = require('../_files');

const MAX_BODY = 50000;
const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h'
};

// "O‘quv natijalarini baholash" → "oquv-natijalarini-baholash"; Cyrillic titles are transliterated.
function slugify(title) {
  const latin = [...title.toLowerCase()].map((ch) => CYRILLIC[ch] ?? ch).join('');
  return latin
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[ʻʼ‘’'`´]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '') || 'maqola';
}

async function freeSlug(base, exceptId) {
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await sql`SELECT 1 FROM np_articles WHERE slug=${slug} AND (${exceptId}::int IS NULL OR id <> ${exceptId}::int) LIMIT 1`;
    if (!taken.length) return slug;
  }
  throw new Error('No free article address');
}

function readArticle(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() : '';
  if (title.length < 3 || title.length > 200) return { error: 'Sarlavha 3–200 belgidan iborat bo‘lsin.' };
  if (text.length < 20 || text.length > MAX_BODY) return { error: 'Maqola matni 20 dan 50 000 belgigacha bo‘lsin.' };
  if (excerpt.length > 300) return { error: 'Qisqa tavsif 300 belgidan oshmasin.' };
  const cover = body.cover_image_id ?? null;
  if (cover !== null && !isUuid(cover)) return { error: 'Muqova rasmi noto‘g‘ri.' };
  return { title, body: text, excerpt: excerpt || text.replace(/[*_#>`[\]()-]/g, '').replace(/\s+/g, ' ').slice(0, 200), cover, published: body.published !== false };
}

// Published articles are public; the administrator writes them and also sees drafts.
module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const viewer = await getSessionUser(req);
      const drafts = viewer?.role === 'admin' && req.query.all === '1';
      res.setHeader('Cache-Control', drafts ? 'no-store' : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
      if (req.query.slug !== undefined) {
        const rows = await sql`
          SELECT a.id, a.slug, a.title, a.excerpt, a.body, a.cover_image_id, a.published, a.created_at, a.updated_at, u.name AS author_name
          FROM np_articles a LEFT JOIN np_users u ON u.id = a.author_id
          WHERE a.slug=${String(req.query.slug)} AND (a.published OR ${viewer?.role === 'admin'}::boolean) LIMIT 1`;
        return rows.length ? res.json(rows[0]) : res.status(404).json({ error: 'Maqola topilmadi.' });
      }
      return res.json(await sql`
        SELECT a.id, a.slug, a.title, a.excerpt, a.cover_image_id, a.published, a.created_at, u.name AS author_name
        FROM np_articles a LEFT JOIN np_users u ON u.id = a.author_id
        WHERE a.published OR ${drafts}::boolean
        ORDER BY a.created_at DESC`);
    }

    res.setHeader('Cache-Control', 'no-store');
    const admin = await requireUser(req, res, ['admin']);
    if (!admin) return;
    if (req.method === 'DELETE') {
      const id = Number(req.query.id);
      const rows = await sql`DELETE FROM np_articles WHERE id=${id} RETURNING title, cover_image_id`;
      if (!rows.length) return res.status(404).json({ error: 'Maqola topilmadi.' });
      if (rows[0].cover_image_id) await sql`DELETE FROM np_images WHERE id=${rows[0].cover_image_id}::uuid`;
      await audit(admin, 'article.delete', `Maqola: ${rows[0].title}`, { article_id: id });
      return res.json({ ok: true });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const article = readArticle(body);
    if (article.error) return res.status(400).json({ error: article.error });
    const id = body.id === undefined || body.id === null ? null : Number(body.id);

    if (id === null) {
      const slug = await freeSlug(slugify(article.title), null);
      const [row] = await sql`
        INSERT INTO np_articles(slug, title, excerpt, body, cover_image_id, author_id, published)
        VALUES(${slug}, ${article.title}, ${article.excerpt}, ${article.body}, ${article.cover}, ${admin.id}, ${article.published})
        RETURNING id, slug, title, published`;
      await audit(admin, 'article.create', `Maqola: ${article.title}`, { article_id: row.id });
      return res.status(201).json(row);
    }

    const [old] = await sql`SELECT cover_image_id FROM np_articles WHERE id=${id}`;
    if (!old) return res.status(404).json({ error: 'Maqola topilmadi.' });
    const [row] = await sql`
      UPDATE np_articles SET title=${article.title}, excerpt=${article.excerpt}, body=${article.body},
             cover_image_id=${article.cover}, published=${article.published}, updated_at=NOW()
      WHERE id=${id} RETURNING id, slug, title, published`;
    // A replaced cover is not used anywhere else.
    if (old.cover_image_id && old.cover_image_id !== article.cover) await sql`DELETE FROM np_images WHERE id=${old.cover_image_id}::uuid`;
    await audit(admin, 'article.update', `Maqola: ${article.title}`, { article_id: id });
    return res.json(row);
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ error: 'Muqova rasmi topilmadi.' });
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};

module.exports.slugify = slugify;
