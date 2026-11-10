// Stands in for the parts of the Supabase Storage REST API the server uses.
const ORIGIN = 'https://fake-project.supabase.co';

function createFakeStorage() {
  const objects = new Map();
  const buckets = new Set();
  const calls = [];
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

  async function fakeFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method, path: url.pathname, headers });
    const route = url.pathname.replace(/^\/storage\/v1/, '');
    const authorised = headers.authorization === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
    const body = init.body === undefined ? null : Buffer.from(init.body instanceof ArrayBuffer ? new Uint8Array(init.body) : init.body);

    if (method === 'POST' && route === '/bucket') {
      if (!authorised) return json({ error: 'unauthorized' }, 401);
      const { id } = JSON.parse(body.toString());
      if (buckets.has(id)) return json({ error: 'Duplicate', message: 'The resource already exists' }, 409);
      buckets.add(id);
      return json({ name: id });
    }
    let match = route.match(/^\/object\/upload\/sign\/([^/]+)\/(.+)$/);
    if (match && method === 'POST') {
      if (!authorised) return json({ error: 'unauthorized' }, 401);
      return json({ url: `/object/upload/sign/${match[1]}/${match[2]}?token=up-${match[2]}` });
    }
    if (match && method === 'PUT') {
      if (url.searchParams.get('token') !== `up-${match[2]}`) return json({ error: 'bad token' }, 400);
      objects.set(decodeURIComponent(match[2]), body);
      return json({ Key: match[2] });
    }
    match = route.match(/^\/object\/sign\/([^/]+)\/(.+)$/);
    if (match && method === 'POST') {
      if (!authorised) return json({ error: 'unauthorized' }, 401);
      if (!objects.has(decodeURIComponent(match[2]))) return json({ error: 'not found' }, 404);
      return json({ signedURL: `/object/sign/${match[1]}/${match[2]}?token=dl` });
    }
    match = route.match(/^\/object\/([^/]+)$/);
    if (match && method === 'DELETE') {
      if (!authorised) return json({ error: 'unauthorized' }, 401);
      for (const path of JSON.parse(body.toString()).prefixes) objects.delete(path);
      return json([]);
    }
    match = route.match(/^\/object\/([^/]+)\/(.+)$/);
    if (match && method === 'POST') {
      if (!authorised) return json({ error: 'unauthorized' }, 401);
      objects.set(decodeURIComponent(match[2]), body);
      return json({ Key: match[2] });
    }
    if (match && method === 'GET') {
      if (!authorised) return json({ error: 'unauthorized' }, 401);
      const data = objects.get(decodeURIComponent(match[2]));
      if (!data) return json({ error: 'not found' }, 404);
      const range = headers.range?.match(/^bytes=(\d+)-(\d+)$/);
      if (range) {
        const part = data.subarray(Number(range[1]), Number(range[2]) + 1);
        return new Response(part, { status: 206, headers: { 'content-range': `bytes ${range[1]}-${range[1] + part.length - 1}/${data.length}` } });
      }
      return new Response(data, { status: 200, headers: { 'content-length': String(data.length) } });
    }
    return json({ error: `unexpected ${method} ${route}` }, 500);
  }

  return {
    objects,
    buckets,
    calls,
    install() {
      const saved = { fetch: global.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
      global.fetch = fakeFetch;
      process.env.SUPABASE_URL = ORIGIN;
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
      return () => {
        global.fetch = saved.fetch;
        if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
        if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
      };
    }
  };
}

module.exports = { createFakeStorage };
