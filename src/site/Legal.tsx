import type { ReactNode } from 'react';

const UPDATED = '2026-yil 10-noyabr';

function Page({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <article className="page-container page-section legal">
      <span className="section-eyebrow">{eyebrow}</span>
      <h1 className="section-heading">{title}</h1>
      <p className="mt-2 text-sm text-muted">Oxirgi yangilanish: {UPDATED}</p>
      <div className="legal-body">{children}</div>
    </article>
  );
}

// Describes what the platform actually stores and where, so it must change whenever that changes.
export function Privacy() {
  return (
    <Page eyebrow="Huquqiy ma’lumot" title="Maxfiylik siyosati">
      <p>Ta'lim Nazariyasi platformasi o‘quv jarayoni uchun zarur bo‘lgan ma’lumotlarnigina to‘playdi. Quyida qaysi ma’lumot nima uchun saqlanishi va qancha vaqt turishi yozilgan.</p>
      <h2>Qanday ma’lumot to‘planadi</h2>
      <ul>
        <li><strong>Hisob ma’lumotlari:</strong> ismingiz, Gmail manzilingiz va rolingiz (talaba, o‘qituvchi yoki administrator). Parol ochiq holda saqlanmaydi, faqat qaytarib bo‘lmaydigan xesh ko‘rinishida turadi.</li>
        <li><strong>O‘quv natijalari:</strong> bajarilgan qadamlar, test javoblari va ballar, yozma javoblar va yuklagan fayllaringiz, o‘qituvchi fikrlari.</li>
        <li><strong>Kirish ma’lumotlari:</strong> ro‘yxatdan o‘tgan va oxirgi kirgan vaqt. Tizimga kirganingizda brauzerga 12 soat amal qiladigan sessiya cookie’si yoziladi; u faqat sizni tanish uchun kerak.</li>
        <li><strong>Texnik jurnal:</strong> saytda xato yuz bersa, xato matni, sahifa manzili va brauzer turi 30 kun saqlanadi. Ortiqcha urinishlarni cheklash uchun IP manzil faqat qaytarib bo‘lmaydigan xesh ko‘rinishida ishlatiladi.</li>
        <li><strong>Brauzer sozlamasi:</strong> tanlagan kunduzgi yoki tungi rejim faqat brauzeringizda saqlanadi.</li>
      </ul>
      <h2>Ma’lumot kimga ko‘rinadi</h2>
      <ul>
        <li>Talabaning natijalari, javoblari va Gmail manzili o‘qituvchilar va administratorga ko‘rinadi: ular ishlarni tekshiradi va baholaydi.</li>
        <li>Boshqa talabalar sizning natijalaringizni ko‘rmaydi.</li>
        <li>Ma’lumotlar sotilmaydi va reklama uchun ishlatilmaydi.</li>
      </ul>
      <h2>Ma’lumot qayerda saqlanadi</h2>
      <p>Sayt Vercel xostingida ishlaydi, ma’lumotlar bazasi va fayllar Supabase serverlarida saqlanadi. Tasdiqlash kodlari va bildirishnomalar elektron pochta xizmati orqali yuboriladi. O‘qituvchilar uchun AI yordamchiga yozilgan savollar javob olish uchun AI xizmatiga uzatiladi; u yerga talabalarning shaxsiy ma’lumotlarini yozmang.</p>
      <h2>Saqlash muddati va huquqlaringiz</h2>
      <p>Hisob ma’lumotlari va natijalar hisob faol ekan saqlanadi. Ma’lumotlaringiz nusxasini olish, ularni tuzatish yoki hisobingizni o‘chirishni so‘rash uchun “Aloqa” bo‘limidagi manzilga yozing; so‘rov 30 kun ichida bajariladi. Ismingizni va parolingizni “Profilim” sahifasida o‘zingiz o‘zgartira olasiz.</p>
    </Page>
  );
}

export function Terms() {
  return (
    <Page eyebrow="Huquqiy ma’lumot" title="Foydalanish shartlari">
      <p>Platformada ro‘yxatdan o‘tish orqali siz quyidagi shartlarga rozilik bildirasiz.</p>
      <h2>Hisob</h2>
      <ul>
        <li>Faqat o‘zingizga tegishli Gmail manzil bilan ro‘yxatdan o‘ting va parolingizni boshqalarga bermang.</li>
        <li>O‘qituvchi hisobi administrator tasdiqlagandan keyin ishlaydi.</li>
        <li>Qoidalarni buzgan hisob bloklanishi mumkin.</li>
      </ul>
      <h2>Materiallar va javoblar</h2>
      <ul>
        <li>O‘qituvchi yuklagan materiallar faqat o‘quv maqsadida ishlatiladi; ularni ruxsatsiz tarqatmang.</li>
        <li>Topshiriq va refleksiyalar sizning mustaqil ishingiz bo‘lishi kerak.</li>
        <li>Zararli, boshqalarning huquqini buzadigan yoki noqonuniy fayl yuklash taqiqlanadi.</li>
      </ul>
      <h2>Javobgarlik</h2>
      <p>Platforma o‘quv jarayonini qo‘llab-quvvatlaydi, lekin uzluksiz ishlashiga kafolat bermaydi. AI tayyorlagan test va javoblar xato bo‘lishi mumkin, ularni o‘qituvchi tekshiradi.</p>
      <h2>O‘zgarishlar</h2>
      <p>Shartlar o‘zgarsa, yangi matn shu sahifada e’lon qilinadi va yuqoridagi sana yangilanadi.</p>
    </Page>
  );
}
