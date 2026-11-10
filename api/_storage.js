// Supabase Storage over its REST API. Turned on by SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY;
// without them files stay in the database in chunks, as before.
const BUCKET = () => process.env.STORAGE_BUCKET || 'files';
const DOWNLOAD_TTL_SECONDS = 300;
const UPLOAD_LIMIT_BYTES = 30 * 1024 * 1024;

class StorageError extends Error {}

function isEnabled() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function base() {
  return `${process.env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1`;
}

function headers(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { authorization: `Bearer ${key}`, apikey: key, ...extra };
}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

async function request(path, options = {}) {
  const res = await fetch(`${base()}${path}`, { ...options, headers: headers(options.headers) });
  if (!res.ok && res.status !== 206) {
    const text = await res.text().catch(() => '');
    throw new StorageError(`Storage ${options.method || 'GET'} ${path.split('?')[0]} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res;
}

// A private bucket: every read goes through a short-lived signed link.
async function ensureBucket() {
  const res = await fetch(`${base()}/bucket`, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET(), name: BUCKET(), public: false, file_size_limit: UPLOAD_LIMIT_BYTES })
  });
  if (res.ok) return 'created';
  const text = await res.text().catch(() => '');
  if (res.status === 409 || /already exists|Duplicate/i.test(text)) return 'exists';
  throw new StorageError(`Bucket could not be created: ${res.status} ${text.slice(0, 200)}`);
}

// The browser sends the file straight to Storage, so it never passes through a serverless body limit.
async function createUploadUrl(path) {
  const res = await request(`/object/upload/sign/${BUCKET()}/${encodePath(path)}`, { method: 'POST' });
  const data = await res.json();
  if (typeof data?.url !== 'string') throw new StorageError('Storage returned no upload link');
  return `${base()}${data.url}`;
}

// Size and first bytes, enough to check the upload against what was announced.
async function inspect(path) {
  const res = await request(`/object/${BUCKET()}/${encodePath(path)}`, { headers: { range: 'bytes=0-15' } });
  const range = res.headers.get('content-range');
  const head = Buffer.from(await res.arrayBuffer()).subarray(0, 16);
  const size = range ? Number(range.split('/')[1]) : Number(res.headers.get('content-length'));
  return { size, head };
}

async function download(path) {
  const res = await request(`/object/${BUCKET()}/${encodePath(path)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function upload(path, bytes, contentType = 'application/octet-stream') {
  await request(`/object/${BUCKET()}/${encodePath(path)}`, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-upsert': 'true' },
    body: bytes
  });
}

// The link answers with Content-Disposition: attachment under the original file name.
async function createDownloadUrl(path, filename) {
  const res = await request(`/object/sign/${BUCKET()}/${encodePath(path)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: DOWNLOAD_TTL_SECONDS })
  });
  const data = await res.json();
  const signed = data?.signedURL || data?.signedUrl;
  if (typeof signed !== 'string') throw new StorageError('Storage returned no download link');
  return `${base()}${signed}${signed.includes('?') ? '&' : '?'}download=${encodeURIComponent(filename)}`;
}

async function remove(paths) {
  const list = paths.filter(Boolean);
  if (!list.length || !isEnabled()) return;
  try {
    await request(`/object/${BUCKET()}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: list })
    });
  } catch (error) {
    // An orphaned object costs space, not correctness; the row is already gone.
    console.error(error.message);
  }
}

module.exports = {
  StorageError, createDownloadUrl, createUploadUrl, download, ensureBucket, inspect, isEnabled, remove, upload
};
