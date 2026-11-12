import type { Certificate } from '../types';
import { deliver, type DownloadResult } from './files';
import { formatGrade } from './grades';
import { uzDate } from './learning';

const W = 2480;
const H = 1754;
const INK = '#2B2622';
const BROWN = '#7A5C2E';
const GOLD = '#C9A46A';

export const verifyUrl = (code: string) => `${location.origin}/#verify/${code}`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// Drawn on a canvas with the site's own font (any alphabet works), then placed on an A4 PDF page.
export async function drawCertificate(certificate: Certificate): Promise<HTMLCanvasElement> {
  const [{ default: QRCode }] = await Promise.all([import('qrcode'), document.fonts.load('700 120px "Onest Variable"'), document.fonts.load('400 60px "Onest Variable"')]);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FBF8F3';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = BROWN;
  ctx.lineWidth = 10;
  ctx.strokeRect(70, 70, W - 140, H - 140);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.strokeRect(100, 100, W - 200, H - 200);

  const logo = await loadImage('/images/logo.png');
  ctx.drawImage(logo, W / 2 - 90, 190, 180, 180);
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = '700 64px "Onest Variable", sans-serif';
  ctx.fillText("Ta'lim Nazariyasi", W / 2, 470);
  ctx.fillStyle = BROWN;
  ctx.font = '700 110px "Onest Variable", sans-serif';
  ctx.fillText('SERTIFIKAT', W / 2, 640);
  ctx.fillStyle = '#655D54';
  ctx.font = '400 52px "Onest Variable", sans-serif';
  ctx.fillText('Ushbu sertifikat', W / 2, 760);
  ctx.fillStyle = INK;
  ctx.font = '700 120px "Onest Variable", sans-serif';
  ctx.fillText(certificate.student_name, W / 2, 900, W - 400);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 600, 950);
  ctx.lineTo(W / 2 + 600, 950);
  ctx.stroke();

  ctx.fillStyle = '#4A4038';
  ctx.font = '400 54px "Onest Variable", sans-serif';
  const lines = wrapLines(ctx, `«${certificate.module_title}» modulining barcha olti qadamini muvaffaqiyatli tamomlagani uchun berildi.`, W - 700);
  lines.slice(0, 3).forEach((line, index) => ctx.fillText(line, W / 2, 1060 + index * 74));

  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = '700 46px "Onest Variable", sans-serif';
  const grade = formatGrade(certificate.grade, certificate.percent);
  ctx.fillText(grade ? `Baho: ${grade}` : `To‘plangan ball: ${certificate.score ?? 0}`, 260, 1430);
  ctx.fillText(`Berilgan sana: ${uzDate(certificate.issued_at)}`, 260, 1500);
  ctx.font = '400 40px "Onest Variable", sans-serif';
  ctx.fillStyle = '#655D54';
  ctx.fillText(`Sertifikat raqami: ${certificate.code}`, 260, 1570);

  const qr = await QRCode.toDataURL(verifyUrl(certificate.code), { margin: 1, width: 300, color: { dark: INK, light: '#FBF8F3' } });
  ctx.drawImage(await loadImage(qr), W - 560, 1260, 300, 300);
  ctx.textAlign = 'center';
  ctx.font = '400 32px "Onest Variable", sans-serif';
  ctx.fillText('Haqiqiyligini tekshirish', W - 410, 1610);
  return canvas;
}

export async function downloadCertificate(certificate: Certificate): Promise<DownloadResult> {
  const [{ PDFDocument }, canvas] = await Promise.all([import('pdf-lib'), drawCertificate(certificate)]);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Sertifikat — ${certificate.module_title}`);
  pdf.setAuthor("Ta'lim Nazariyasi");
  const jpeg = await pdf.embedJpg(canvas.toDataURL('image/jpeg', 0.92));
  const page = pdf.addPage([841.89, 595.28]);
  page.drawImage(jpeg, { x: 0, y: 0, width: 841.89, height: 595.28 });
  const bytes = await pdf.save();
  return deliver([new Uint8Array(bytes)], `sertifikat-${certificate.code}.pdf`);
}
