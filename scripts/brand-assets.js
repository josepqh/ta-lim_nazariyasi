// Renders the PNG icons and the social share image from public/images/logo.svg.
// Run after changing the logo: node scripts/brand-assets.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const logo = fs.readFileSync(path.join(publicDir, 'images/logo.svg'), 'utf8');
// Home-screen icons are cropped by the system (iOS, Android masks), so they get square corners.
const squareLogo = logo.replace(' rx="116"', '');
const dataUri = (buffer, type) => `data:${type};base64,${buffer.toString('base64')}`;
const svgUri = (svg) => dataUri(Buffer.from(svg), 'image/svg+xml');

const ICONS = [
  { file: 'images/logo.png', size: 512, svg: logo },
  { file: 'images/logo-maskable.png', size: 512, svg: squareLogo },
  { file: 'images/apple-touch-icon.png', size: 180, svg: squareLogo }
];

function shareCard() {
  const font = fs.readFileSync(path.join(root, 'node_modules/@fontsource-variable/onest/files/onest-latin-wght-normal.woff2'));
  const hero = fs.readFileSync(path.join(publicDir, 'images/hero-1600.webp'));
  return `<!doctype html><html><head><style>
    @font-face { font-family: Onest; src: url(${dataUri(font, 'font/woff2')}) format('woff2'); font-weight: 100 900; }
    * { margin: 0; box-sizing: border-box; }
    body { width: 1200px; height: 630px; font-family: Onest; color: #fff; position: relative; overflow: hidden; }
    .bg { position: absolute; inset: 0; background: url(${dataUri(hero, 'image/webp')}) center / cover; }
    .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(23,21,19,.88) 0%, rgba(23,21,19,.7) 48%, rgba(23,21,19,.35) 100%); }
    .content { position: absolute; left: 80px; top: 126px; right: 80px; }
    .brand { display: flex; align-items: center; gap: 18px; margin-bottom: 48px; }
    .brand img { width: 64px; height: 64px; }
    .brand span { font-size: 25px; font-weight: 700; line-height: 1.1; }
    h1 { font-size: 64px; line-height: 1.12; font-weight: 700; letter-spacing: -0.01em; max-width: 720px; }
    h1 em { font-style: normal; color: #E3C79B; }
    p { margin-top: 30px; font-size: 22px; font-weight: 500; opacity: .92; }
  </style></head><body>
    <div class="bg"></div><div class="shade"></div>
    <div class="content">
      <div class="brand"><img src="${svgUri(logo)}" alt=""/><span>Ta'lim<br/>Nazariyasi</span></div>
      <h1>Pedagogika va didaktikani <em>6 qadamda</em> o‘rganing</h1>
      <p>Test, video dars, taqdimot, amaliy topshiriq va refleksiya</p>
    </div>
  </body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const icon of ICONS) {
      await page.setViewportSize({ width: icon.size, height: icon.size });
      await page.setContent(`<style>*{margin:0}</style><img src="${svgUri(icon.svg)}" width="${icon.size}" height="${icon.size}" style="display:block"/>`);
      await page.screenshot({ path: path.join(publicDir, icon.file), omitBackground: true });
      console.log(`wrote public/${icon.file}`);
    }
    await page.setViewportSize({ width: 1200, height: 630 });
    await page.setContent(shareCard(), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(publicDir, 'og-image.jpg'), type: 'jpeg', quality: 85 });
    console.log('wrote public/og-image.jpg');
  } finally {
    await browser.close();
  }
})();
