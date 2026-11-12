# Ta'lim nazariyasi platformasi

Ta'lim nazariyasi bo‘yicha olti qadamli modullar platformasi. Frontend React + TypeScript (Vite, Tailwind CSS, TanStack Query, Zustand), server qismi Vercel serverless funksiyalari (`api/`), ma’lumotlar Supabase PostgreSQL’da.

## Tuzilma

- `src/` — React ilova: `site/` (ochiq sayt), `cabinet/` (kabinet sahifalari), `components/`, `lib/` (API, fayllar, so‘rovlar), `store.ts` (holat va manzillar).
- `public/` — rasmlar, `robots.txt`, `sitemap.xml`, manifest, ijtimoiy tarmoq rasmi (`og-image.jpg`).
- `api/router.js` — yagona serverless funksiya: `vercel.json` `/api/<nom>` so‘rovlarini unga yo‘naltiradi, u esa `api/_routes/<nom>.js` ga uzatadi. Yangi endpoint uchun `api/_routes/` ga fayl qo‘shib, `api/_routes/index.js` ga yozing; Vercel’ning funksiyalar soni cheklovi ta’sir qilmaydi. `api/_migrations/` — bazaning versiyalangan migratsiyalari.
- `scripts/` — lokal ishga tushirish va fayllarni Storage’ga ko‘chirish skriptlari.
- `tests/` — API testlari (`node --test`, xotiradagi PGlite bazada) va Playwright E2E testlari.

## Ishga tushirish

Node.js 20+ kerak. `npm install`, so‘ng `.env.example` dan `.env` yarating:

- `DATABASE_URL` — Supabase “Transaction pooler” manzili (6543-port).
- `SETUP_SECRET` — `/api/setup` ni himoyalovchi 24+ belgili sir (`openssl rand -base64 48`).
- `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `ADMIN_NAME` — admin hisobi (Gmail), parol kamida 10 belgi.
- `GROQ_API_KEY` — AI yordamchi va AI test tuzish uchun.
- Xat: `RESEND_API_KEY` va `MAIL_FROM` (o‘z domeningizdagi manzil) bo‘lsa xatlar Resend orqali ketadi; bo‘lmasa `GMAIL_USER` va `GMAIL_APP_PASSWORD` ishlatiladi.
- Fayllar: `SUPABASE_URL` va `SUPABASE_SERVICE_ROLE_KEY` bo‘lsa fayllar Supabase Storage’da saqlanadi; bo‘lmasa bazada 3 MB’lik bo‘laklar bilan.

`.env` repoga qo‘shilmaydi. Xuddi shu qiymatlarni Vercel → Settings → Environment Variables’ga ham kiriting.

```sh
npm run db:migrate   # migratsiyalar, admin hisobi, Storage bucket
npm run dev          # Vite (http://localhost:5173) + lokal API (:3000)
npm run build        # tsc + vite build → dist/
npm start            # yig‘ilgan saytni lokal API bilan ishga tushiradi
```

`.env` da `DATABASE_URL` bo‘lmasa, lokal server ma’lumotlarni `.local-db/` papkasida saqlaydi va tasdiqlash kodlarini terminalga chiqaradi.

## Rollar va ruxsatlar

- Talaba ro‘yxatdan o‘tgach darhol kiradi.
- O‘qituvchi Gmail’ni tasdiqlagach **administrator tasdig‘ini kutadi**: admin “Foydalanuvchilar → Tasdiq kutayotganlar” bo‘limida tasdiqlaydi yoki rad etadi, ikkala holatda ham xat boradi.
- O‘qituvchi faqat **o‘zi yaratgan modullarni** tahrirlaydi, o‘chiradi, materiallarini o‘zgartiradi va ularning javoblarini baholaydi; administrator hammasini boshqaradi. Bu qoida serverda (`api/_modules.js`) tekshiriladi.

## Kirish va sessiya

- Sessiya 12 soat ishlatilmasa tugaydi; foydalanilgan sari muddati uzayadi (soatiga ko‘pi bilan bir marta). Tugagan sessiyada sayt kirish oynasini ochadi va qayta kirgach o‘sha sahifaga qaytaradi.
- Noto‘g‘ri parol: bitta hisobga bitta manzildan 15 daqiqada 5 ta urinish (hisob faqat o‘sha manzil uchun qulflanadi), bitta manzildan istalgan hisoblarga 15 daqiqada 20 ta, bitta hisobga barcha manzillardan soatiga 50 ta. Parolni tiklash qulfni darhol ochadi.
- Eski `np_rate_limits`, `np_email_codes` va `np_sessions` yozuvlari so‘rovlar orasida vaqti-vaqti bilan o‘chiriladi (`api/_cleanup.js`).

## O‘quv imkoniyatlari

- **Guruhlar.** O‘qituvchi “Guruhlar” bo‘limida guruh yaratadi va 6 belgili taklif kodini talabalarga beradi; talaba kabinetdagi “Guruhlarim” orqali qo‘shiladi. Tahlil va javoblar sahifalarida natijalarni guruh bo‘yicha saralash mumkin. Kod oshkor bo‘lsa, “Yangi kod” eskisini bekor qiladi.
- **Sertifikatlar.** Talaba modulning oltita qadamini tugatganda sertifikat avtomatik beriladi. PDF brauzerda chiziladi (ism, modul, ball, sana, raqam, QR kod). Istalgan kishi uni saytdagi “Sertifikatni tekshirish” sahifasida (`#verify/RAQAM`) tekshira oladi.
- **Testni qayta topshirish va izohlar.** Test muharririda o‘qituvchi “qayta topshirish mumkin” va “to‘g‘ri javoblarni ko‘rsatish” ni yoqadi, har savolga izoh yozadi. Qayta topshirishda savollar yangi tartibda chiqadi, eng yaxshi natija hisobga olinadi.
- **Matn muharriri.** Topshiriq, refleksiya, material izohlari va maqolalar Markdown’da yoziladi (qalin, kursiv, sarlavha, ro‘yxat, iqtibos, havola). Ko‘rsatishda matn HTML sifatida emas, React elementlari sifatida chiziladi; havolalar faqat `http(s)` va `mailto`.
- **Maqolalar.** Administrator “Maqolalar” bo‘limida muqovali maqola yozadi, qoralama qilib saqlay oladi.
- **Muqovalar.** Modul va maqolaga rasm qo‘yiladi; brauzer uni 1200 px gacha kichraytirib yuboradi, server formatini tekshiradi.
- **Amallar jurnali.** Tasdiqlash, o‘chirish, modul va material o‘zgarishlari, baholash va guruh amallari yoziladi; admin “Jurnallar” sahifasida ko‘radi.
- **Bosh sahifadagi raqamlar** `/api/stats` dan keladi va 5 daqiqa keshlanadi.

## Migratsiyalar

Baza sxemasi `api/_migrations/` dagi fayllarda. Har bir migratsiya bir marta, o‘z tranzaksiyasida bajariladi va `np_schema_migrations` jadvaliga yoziladi. Yangi o‘zgarish uchun keyingi raqamli fayl qo‘shing va `api/_migrations/index.js` ga ulang; joylangan migratsiyani o‘zgartirmang. `npm run db:migrate` yoki `POST /api/setup` (Bearer `SETUP_SECRET`) faqat yangilarini bajaradi.

## Fayllar va Supabase Storage

Storage yoqilganda brauzer faylni to‘g‘ridan-to‘g‘ri Supabase’ga yuklaydi (Vercel’ning 4.5 MB cheklovi ta’sir qilmaydi), server esa hajmi va formatini tekshiradi. Yuklab olish 5 daqiqalik imzolangan havola orqali bo‘ladi. Bucket xususiy (`public: false`) va `npm run db:migrate` da yaratiladi. Eski, bazadagi fayllarni ko‘chirish:

```sh
npm run storage:migrate
```

## Xatolar jurnali

Server va brauzer xatolari `np_error_logs` jadvaliga yoziladi va 30 kun saqlanadi. Admin ularni kabinetdagi “Xatolar jurnali” sahifasida ko‘radi.

## Zaxira nusxalar

`.github/workflows/backup.yml` har kecha 02:30 da (Toshkent) bazani `pg_dump` bilan oladi, AES-256 bilan shifrlaydi va GitHub Actions artefakti sifatida 30 kun saqlaydi. GitHub → Settings → Secrets and variables → Actions’ga qo‘shing:

- `BACKUP_DATABASE_URL` — Supabase **Session pooler** manzili (5432-port; `pg_dump` transaction pooler bilan ishlamaydi).
- `BACKUP_PASSPHRASE` — uzun tasodifiy parol; uni boshqa joyda ham saqlang, usiz nusxani ochib bo‘lmaydi.

Tiklash: Actions’dan artefaktni yuklab oling, so‘ng

```sh
gpg --decrypt database.dump.gpg > database.dump
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" database.dump
```

Storage’dagi fayllar bu nusxaga kirmaydi; ular Supabase’da alohida saqlanadi.

## Testlar

```sh
npm test            # API testlari
npm run test:e2e    # brauzer testlari (avval saytni yig‘adi)
```

Birinchi marta `npx playwright install chromium` kerak. CI har push’da typecheck, build, API va E2E testlarni yurgizadi.
