class MailNotConfiguredError extends Error {}

const APP_NAME = "Ta'lim Nazariyasi";
const usesResend = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
const usesGmail = () => Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

// A transactional service on your own domain (SPF/DKIM) reaches the inbox; Gmail SMTP is the fallback.
async function sendWithResend(to, subject, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: `${APP_NAME} <${process.env.MAIL_FROM}>`, to: [to], subject, text })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Mail service refused the message: ${res.status} ${detail.slice(0, 120)}`);
  }
  console.log('Mail accepted by the mail service');
}

async function sendWithGmail(to, subject, text) {
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
  const info = await transport.sendMail({ from: `"${APP_NAME}" <${process.env.GMAIL_USER}>`, to, subject, text });
  if (info.rejected?.length) throw new Error('Mail server rejected the recipient');
  console.log(`Mail accepted by server: ${String(info.response).slice(0, 40)}`);
}

async function deliver(to, subject, text) {
  if (usesResend()) return sendWithResend(to, subject, text);
  if (usesGmail()) return sendWithGmail(to, subject, text);
  // Set only by the local development server, so production can never skip sending.
  if (process.env.LOCAL_DEV_MAIL === '1') {
    console.log(`\n[Lokal xat] ${to}\n${subject}\n${text}\n`);
    return;
  }
  throw new MailNotConfiguredError('Mail is not configured');
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

// Notices that must never block the request that triggers them.
async function notify(to, subject, text) {
  try {
    await deliver(to, subject, text);
  } catch (error) {
    if (!(error instanceof MailNotConfiguredError)) console.error('Notice not delivered:', error.message);
  }
}

function sendTeacherRequest(to, teacherName, teacherEmail) {
  return notify(
    to,
    `${APP_NAME}: yangi o‘qituvchi tasdiq kutmoqda`,
    `Salom!\n\n${teacherName} (${teacherEmail}) o‘qituvchi sifatida ro‘yxatdan o‘tdi.\nSaytga kirib, "Foydalanuvchilar" bo‘limidagi "Tasdiq kutayotganlar" ro‘yxatida tasdiqlang yoki rad eting.`
  );
}

function sendTeacherDecision(to, approved) {
  return notify(
    to,
    `${APP_NAME}: ${approved ? 'hisobingiz tasdiqlandi' : 'so‘rovingiz rad etildi'}`,
    approved
      ? 'Salom!\n\nAdministrator o‘qituvchi hisobingizni tasdiqladi. Endi shu Gmail va parolingiz bilan saytga kirishingiz mumkin.'
      : 'Salom!\n\nAdministrator o‘qituvchi sifatida ro‘yxatdan o‘tish so‘rovingizni rad etdi. Savollar bo‘lsa, administratorga murojaat qiling.'
  );
}

module.exports = { MailNotConfiguredError, sendCode, sendExistingAccountNotice, sendTeacherDecision, sendTeacherRequest };
