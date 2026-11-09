class MailNotConfiguredError extends Error {}

const APP_NAME = "Ta'lim Nazariyasi";
const isConfigured = () => Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

async function deliver(to, subject, text) {
  if (!isConfigured()) {
    // Set only by the local development server, so production can never skip sending.
    if (process.env.LOCAL_DEV_MAIL === '1') {
      console.log(`\n[Lokal xat] ${to}\n${subject}\n${text}\n`);
      return;
    }
    throw new MailNotConfiguredError('Mail is not configured');
  }
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
  const info = await transport.sendMail({ from: `"${APP_NAME}" <${process.env.GMAIL_USER}>`, to, subject, text });
  if (info.rejected?.length) throw new Error('Mail server rejected the recipient');
  console.log(`Mail accepted by server: ${String(info.response).slice(0, 40)}`);
}

function sendCode(to, code, purpose) {
  const action = purpose === 'reset' ? 'parolni tiklash' : 'ro‘yxatdan o‘tish';
  return deliver(
    to,
    `${APP_NAME}: tasdiqlash kodi ${code}`,
    `Salom!\n\n${action[0].toUpperCase()}${action.slice(1)} uchun kodingiz: ${code}\n\nKod 10 daqiqa amal qiladi. Uni hech kimga bermang.\nAgar bu siz bo‘lmasangiz, xatga e’tibor bermang.`
  );
}

function sendExistingAccountNotice(to) {
  return deliver(
    to,
    `${APP_NAME}: hisobingiz allaqachon bor`,
    'Salom!\n\nBu Gmail bilan hisob allaqachon ochilgan. Saytga kiring yoki "Parolni unutdingizmi?" orqali parolni tiklang.\nAgar bu siz bo‘lmasangiz, xatga e’tibor bermang.'
  );
}

module.exports = { MailNotConfiguredError, sendCode, sendExistingAccountNotice };
