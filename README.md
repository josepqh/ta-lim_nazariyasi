# Ta'lim nazariyasi platformasi

Yengil frontend (`index.html`, `style.css`, `app.js`) va Vercel serverless API (`api/`) asosidagi o‘quv platformasi. Ma’lumotlar Neon PostgreSQL’da saqlanadi.

## Ishga tushirish

Node.js 18 yoki yangiroq versiya kerak. `npm install` buyrug‘ini bajaring, so‘ng `.env.example` faylidan `.env` yarating. Quyidagi qiymatlarni to‘ldiring:

- `DATABASE_URL` — Neon ulanish manzili.
- `SETUP_SECRET` — ma’lumotlar bazasini sozlash endpointini himoyalovchi 24+ belgili sir.
- `ADMIN_LOGIN`, `ADMIN_PASSWORD` — boshlang‘ich admin hisobi; parol kamida 10 belgi.
- `ADMIN_NAME` — admin ko‘rinadigan ismi.
- `GROQ_API_KEY` — o‘qituvchi va admin uchun AI chat kaliti (console.groq.com). Bo‘lmasa, chat oynasi ochiladi, lekin “sozlanmagan” xabarini beradi.

Sirlarni yaratish uchun `openssl rand -base64 48` buyrug‘idan foydalanish mumkin. `.env` repoga qo‘shilmaydi.

Jadval va admin hisobini yaratish yoki yangilash:

```sh
npm run db:setup
```

Ilovani Vercel’ga joylaganda shu muhit qiymatlarini Vercel sozlamalarida ham kiriting. Sayt va `/api` bir xil domenda ishlashi kerak. `/api/setup` faqat POST so‘rovini va `SETUP_SECRET` bilan berilgan Bearer kalitni qabul qiladi.

## Rollar

Ro‘yxatdan o‘tishda talaba yoki o‘qituvchi rolini tanlash mumkin; admin hisobi faqat `.env` orqali yaratiladi. Admin “Foydalanuvchilar” bo‘limida barcha talaba va o‘qituvchilarni ko‘radi.

O‘qituvchi va admin amallari serverda tekshiriladi. Eski demo hisoblar `npm run db:setup` bajarilganda o‘chiriladi, ochiq saqlangan parollar xeshlanadi; admin hisobi `.env` qiymatlari bilan yaratiladi.

## Fayllar

Taqdimot (`.pptx`), qo‘shimcha material va topshiriq fayllari PostgreSQL’da 3 MB’lik bo‘laklar bilan saqlanadi (`np_files`, `np_file_chunks`); bitta fayl 30 MB gacha. Yuklab olish uchun tizimga kirish shart, talaba javobi fayllarini faqat egasi, o‘qituvchi va admin ko‘radi.

## Lokal ishlab chiqish va testlar

`npm run dev` (yoki `npm start`) saytni va haqiqiy API’ni ishga tushiradi. `.env` da `DATABASE_URL` bo‘lsa, o‘sha bazaga ulanadi (avval `npm run db:setup`); bo‘lmasa ma’lumotlar lokal `.local-db/` papkasida saqlanadi. Lokal rejimda sinov hisoblari bor (login / parol): `student` / `123`, `teacher` / `123`, `admin` / `123`; ular real bazada yaratilmaydi. `npm test` API testlarini, `npm run test:e2e` brauzer testlarini ishga tushiradi (birinchi marta `npx playwright install chromium` kerak). Baza sxemasining yagona manbasi `api/setup.js`.
