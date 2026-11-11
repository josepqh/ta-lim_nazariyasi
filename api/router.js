const ROUTES = require('./_routes');

// The one serverless function behind /api/*. vercel.json rewrites /api/<name> to
// /api/router?__route=<name>, so new endpoints never count against the function limit.
module.exports = async (req, res) => {
  const fromQuery = req.query?.__route;
  const fromPath = (req.url || '').split('?')[0].replace(/^\/api\//, '');
  const name = typeof fromQuery === 'string' && fromQuery ? fromQuery : fromPath;
  if (req.query) delete req.query.__route;
  const handler = Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
  if (!handler) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'So‘ralgan manzil topilmadi.' });
  }
  return handler(req, res);
};
