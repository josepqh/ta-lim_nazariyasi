const { requireUser } = require('../_auth');
const { reportServerError } = require('../_errors');
const llm = require('../_llm');
const { consumeLimit } = require('../_rateLimit');

const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_REQUESTS_PER_HOUR = 40;

function parseMessages(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MESSAGES) return null;
  const messages = [];
  for (const [index, item] of value.entries()) {
    const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
    const content = typeof item?.content === 'string' ? item.content.trim() : '';
    if (item?.role !== expectedRole || !content || content.length > MAX_MESSAGE_LENGTH) return null;
    messages.push({ role: expectedRole, content });
  }
  return messages[messages.length - 1].role === 'user' ? messages : null;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Ruxsat etilmagan so‘rov.' });

    const user = await requireUser(req, res, ['teacher', 'admin']);
    if (!user) return;

    const messages = parseMessages(req.body?.messages);
    if (!messages) return res.status(400).json({ error: 'Xabar noto‘g‘ri yoki juda uzun.' });

    if (!(await consumeLimit(`chat:user:${user.id}`, MAX_REQUESTS_PER_HOUR, 3600))) {
      return res.status(429).json({ error: 'Bir soatlik xabarlar chegarasiga yetdingiz. Keyinroq urinib ko‘ring.' });
    }

    return res.json({ reply: await llm.askAssistant(messages) });
  } catch (error) {
    if (error instanceof llm.AssistantError) return res.status(error.status).json({ error: error.message });
    await reportServerError(error, req);
    return res.status(500).json({ error: 'Serverda ichki xato yuz berdi.' });
  }
};
