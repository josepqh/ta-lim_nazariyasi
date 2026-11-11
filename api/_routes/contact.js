const { getSessionUser } = require('../_auth');
const { reportServerError } = require('../_errors');
const mail = require('../_mail');
const { isWithinLimit } = require('../_rateLimit');

// Where questions from the "Aloqa" form arrive. CONTACT_EMAIL overrides it without a code change.
const DEFAULT_INBOX = 'uzforedu@gmail.com';
const MAX_MESSAGES_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    // A hidden field people never see; a bot that fills it gets the usual answer and nothing is sent.
    if (typeof body.website === 'string' && body.website.trim()) return res.status(202).json({ ok: true });

    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Ismingizni kiriting (2–100 belgi).' });
    if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'To‘g‘ri email manzilini kiriting.' });
    if (message.length < 10 || message.length > 5000) return res.status(400).json({ error: 'Savolingizni yozing (10–5000 belgi).' });
    if (!(await isWithinLimit('contact', req, MAX_MESSAGES_PER_HOUR, 3600))) {
      return res.status(429).json({ error: 'Juda ko‘p xabar yuborildi. Bir soatdan keyin qayta urinib ko‘ring.' });
    }

    const user = await getSessionUser(req);
    const signature = user ? `${name} (saytdagi hisob: ${user.login})` : name;
    try {
      await mail.sendContactMessage(process.env.CONTACT_EMAIL || DEFAULT_INBOX, { name: signature, email, message });
    } catch (error) {
      if (!(error instanceof mail.MailNotConfiguredError)) await reportServerError(error, req);
      return res.status(503).json({ error: 'Xabarni yuborib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring yoki uzforedu@gmail.com manziliga to‘g‘ridan-to‘g‘ri yozing.' });
    }
    return res.status(202).json({ ok: true });
  } catch (error) {
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
