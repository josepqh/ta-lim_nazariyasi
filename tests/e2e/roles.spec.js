const { expect, request, test } = require('@playwright/test');
const { TEST_ADMIN } = require('../helpers/harness');

const PASSWORD = 'a-valid-password';
const ACTIVE = /(^|\s)active(\s|$)/;
const PPTX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(4000, 9)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(2000, 1)]);
const file = (name, buffer, mimeType = 'application/octet-stream') => ({ name, mimeType, buffer });

let counter = 0;
const unique = (prefix) => `${prefix}_${Date.now()}_${++counter}`;

const openManage = async (page) => {
  await openMenu(page, 'Modullar');
  await page.locator('#tabManage').click();
};

async function emailedCode(page, email) {
  const response = await page.request.get(`/__test/mail?to=${encodeURIComponent(email)}`);
  const { code } = await response.json();
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

// The administrator approves a waiting teacher through the API, in a session of its own.
async function approveTeacher(page, email) {
  const admin = await request.newContext({ baseURL: new URL(page.url()).origin });
  expect((await admin.post('/api/auth', { data: { action: 'login', ...TEST_ADMIN } })).ok()).toBe(true);
  const queue = await (await admin.get(`/api/users?status=pending&q=${encodeURIComponent(email)}`)).json();
  const row = queue.items.find((item) => item.login === email);
  expect(row).toBeTruthy();
  expect((await admin.post('/api/users', { data: { action: 'approve', id: row.id } })).ok()).toBe(true);
  await admin.dispose();
}

// Teachers wait for approval after the emailed code, so the helper approves them and signs them in.
async function register(page, { name, login, role }) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#navRegister').click();
  await page.locator(`#registerForm .role-tab[data-role="${role}"]`).click();
  await page.locator('#regName').fill(name);
  const email = `${login}@gmail.com`;
  await page.locator('#regLogin').fill(email);
  await page.locator('#regPass').fill(PASSWORD);
  await page.locator('#registerForm button[type="submit"]').click();
  await expect(page.locator('#registerCodeForm')).toHaveClass(ACTIVE);
  await page.locator('#regCode').fill(await emailedCode(page, email));
  await page.locator('#registerCodeForm button[type="submit"]').click();
  if (role === 'teacher') {
    await expect(page.locator('#registerPending')).toBeVisible();
    await expect(page.locator('#screen-app')).not.toHaveClass(ACTIVE);
    await approveTeacher(page, email);
    await page.getByRole('button', { name: 'Tushunarli' }).click();
    await signIn(page, { login: email, password: PASSWORD, role: 'teacher' });
  }
  await expect(page.locator('#screen-app')).toHaveClass(ACTIVE);
  await expect(page.locator('#pageTitle')).toHaveText('Boshqaruv paneli');
}

async function signIn(page, { login, password, role }) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#navLogin').click();
  await page.locator(`#loginForm .role-tab[data-role="${role}"]`).click();
  await page.locator('#loginUser').fill(login);
  await page.locator('#loginPass').fill(password);
  await page.locator('#loginForm button[type="submit"]').click();
}

const openMenu = (page, title) => page.locator('#sidebarNav .nav-item', { hasText: title }).click();

async function quizPdf(browser) {
  const page = await browser.newPage();
  const lines = ['1. Didaktika qaysi fan sohasi?', 'A) Kimyo', '*B) Pedagogika', 'C) Fizika', 'D) Tarix',
    '2. Ikki karra ikki necha?', '*A) To‘rt', 'B) Uch', 'C) Besh', 'D) Olti',
    '3. Poytaxt qaysi?', 'A) Samarqand', 'B) Buxoro', '*C) Toshkent', 'D) Xiva'];
  await page.setContent(lines.map((line) => `<p>${line}</p>`).join(''));
  const pdf = await page.pdf();
  await page.close();
  return pdf;
}

async function fillNewModuleForm(page, browser, title, order) {
  await openManage(page);
  await page.locator('#newModOrder').fill(String(order));
  await page.locator('#newModTitle').fill(title);
  await page.locator('#newQuizFile').setInputFiles(file('test.pdf', await quizPdf(browser)));
  await page.locator('#newQuizPrepare').click();
  await expect(page.locator('#newQuizPreview .quiz-summary')).toContainText('3 ta savol');
  await expect(page.locator('#newQuizPreview .quiz-summary')).toContainText('Hammasida');
  await page.locator('#newVideo').fill('https://www.youtube.com/watch?v=aaaaaaaaaaa');
  await page.locator('#newPresFile').setInputFiles(file('dars.pptx', PPTX));
  await page.locator('#newDocFile').setInputFiles(file('qollanma.pdf', PDF));
  await page.locator('#newTask').fill('Dars rejasini tuzing');
  await page.locator('#newRefl').fill('Nimani o‘rgandingiz?');
}

async function publishFullModule(page, browser, title, order) {
  await fillNewModuleForm(page, browser, title, order);
  await page.getByRole('button', { name: 'Modulni yaratish' }).click();
  await expect(page.locator('#toast')).toContainText('barcha materiallari');
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function answerQuizCorrectly(page) {
  // The third answer is wrong on purpose, so result views have something to show.
  const correct = ['Pedagogika', 'To‘rt', 'Buxoro'];
  const groups = page.locator('.student-question');
  await expect(groups).toHaveCount(3);
  const count = await groups.count();
  for (let i = 0; i < count; i++) {
    let done = false;
    for (const text of correct) {
      const option = groups.nth(i).locator('.quiz-option', { hasText: text });
      if (await option.count()) {
        await option.locator('input').check();
        done = true;
      }
    }
    expect(done).toBe(true);
  }
}

async function doStep(page, index, fill) {
  await page.locator('.step-item').nth(index).click();
  if (fill) await fill(page);
  await page.locator('#stepFooter [data-step-action]').click();
  await expect(page.locator('.step-item').nth(index)).toHaveClass(/(^|\s)completed(\s|$)/);
}

test('a wrong password shows an error and never enters the app', async ({ page }) => {
  await signIn(page, { login: 'nobody_here', password: 'wrong-password', role: 'admin' });
  await expect(page.locator('#loginError')).toHaveText('Gmail yoki parol noto‘g‘ri.');
  await expect(page.locator('#screen-app')).not.toHaveClass(ACTIVE);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('teacher publishes, student submits a file, teacher and admin see the work', async ({ browser }) => {
  const moduleTitle = unique('Didaktika');
  const studentName = unique('Nilufar');
  const teacherName = unique('Malika');
  const teacherLogin = unique('teacher');

  const teacherPage = await (await browser.newContext()).newPage();
  const studentPage = await (await browser.newContext()).newPage();
  const adminPage = await (await browser.newContext({ acceptDownloads: true })).newPage();

  await test.step('a teacher registers and publishes a module', async () => {
    await register(teacherPage, { name: teacherName, login: teacherLogin, role: 'teacher' });
    await publishFullModule(teacherPage, browser, moduleTitle, 1000 + Math.floor(Math.random() * 100000));
    await openMenu(teacherPage, 'Tahlil va Grafika');
    await expect(teacherPage.getByText('Aziz Talaba')).toHaveCount(0);
  });

  await test.step('a student has no results page and completes every step', async () => {
    await register(studentPage, { name: studentName, login: unique('student'), role: 'student' });
    await expect(studentPage.locator('#sidebarNav .nav-item', { hasText: 'Mening natijalarim' })).toHaveCount(0);
    await expect(studentPage.locator('#sidebarNav .nav-item', { hasText: 'Tahlil' })).toHaveCount(0);

    await openMenu(studentPage, 'Modullar');
    await studentPage.locator('.module-card', { hasText: moduleTitle }).click();
    await expect(studentPage.locator('.step-item')).toHaveCount(6);

    await doStep(studentPage, 0, answerQuizCorrectly);
    await expect(studentPage.locator('#toast')).toContainText('2/3');
    await doStep(studentPage, 1);
    await doStep(studentPage, 2);
    await doStep(studentPage, 3);
    await doStep(studentPage, 4, async (p) => {
      await p.locator('#stepResponse').fill('Mening rejam');
      await p.locator('#stepFile').setInputFiles(file('javob.pdf', PDF));
    });
    await doStep(studentPage, 5, (p) => p.locator('#stepResponse').fill('Ko‘p narsa o‘rgandim'));
    await expect(studentPage.locator('.celebration-box')).toBeVisible();
    await expect(studentPage.locator('.step-item.completed')).toHaveCount(6);
  });

  await test.step('the teacher opens the student from the leaderboard', async () => {
    await openMenu(teacherPage, 'Modullar');
    await expect(teacherPage.locator('.module-card', { hasText: moduleTitle }).locator('.mod-status.done')).toHaveCount(0);
    await teacherPage.locator('.module-card', { hasText: moduleTitle }).click();
    await expect(teacherPage.locator('.step-item')).toHaveCount(6);
    await expect(teacherPage.locator('.step-item.completed')).toHaveCount(0);
    await expect(teacherPage.locator('.steps-list')).not.toContainText('Bajarildi');

    await openMenu(teacherPage, 'Tahlil va Grafika');
    const moduleRow = teacherPage.locator('.module-stats-table tr', { hasText: moduleTitle });
    await expect(moduleRow.locator('td[data-label="Boshlaganlar"]')).toHaveText('1 ta');
    await expect(moduleRow.locator('td[data-label="Tugatganlar"]')).toHaveText('1 ta');
    await expect(moduleRow.locator('td[data-label="Jarayonda"]')).toHaveText('0 ta');
    await expect(moduleRow.locator('td[data-label="O‘rtacha test"]')).toHaveText('67%');
    await expect(teacherPage.locator('tr', { hasText: studentName })).toContainText('2/3');
    await teacherPage.getByRole('button', { name: studentName }).click();
    const work = teacherPage.locator('.work-module', { hasText: moduleTitle });
    const missed = work.locator('.quiz-wrong-list li');
    await expect(missed).toHaveCount(1);
    await expect(missed).toContainText('Poytaxt qaysi?');
    await expect(missed.locator('.quiz-wrong-answer')).toContainText('Buxoro');
    await expect(missed.locator('.quiz-right-answer')).toContainText('Toshkent');
    await expect(work.getByText('Mening rejam')).toBeVisible();
    await expect(work.getByText('javob.pdf')).toBeVisible();
  });

  await test.step('the submissions page shows the test result', async () => {
    await openMenu(teacherPage, 'Talaba javoblari');
    await teacherPage.locator('#submissionModule').selectOption({ label: await teacherPage.locator('#submissionModule option', { hasText: moduleTitle }).innerText() });
    const card = teacherPage.locator('.submission-card', { hasText: 'Diagnostika testi' }).filter({ hasText: studentName });
    await expect(card).toContainText('2/3');
    await expect(card.locator('.quiz-wrong-answer')).toContainText('Buxoro');
  });

  await test.step('the admin sees both accounts and can download the submission', async () => {
    await signIn(adminPage, { ...TEST_ADMIN, role: 'admin' });
    await openMenu(adminPage, 'Foydalanuvchilar');
    await adminPage.getByRole('button', { name: studentName }).click();
    await expect(adminPage.getByText('Ro‘yxatdan o‘tgan')).toBeVisible();

    const downloadPromise = adminPage.waitForEvent('download');
    await adminPage.getByRole('button', { name: /javob\.pdf/ }).click();
    expect((await downloadPromise).suggestedFilename()).toBe('javob.pdf');

    await adminPage.getByRole('button', { name: /ro‘yxatiga/ }).click();
    await adminPage.locator('#usersTabTeacher').click();
    await expect(adminPage.getByRole('button', { name: teacherName })).toBeVisible();
  });
});

test('a deleted module can be restored', async ({ page, browser }) => {
  const title = unique('Tiklanadigan');
  await register(page, { name: 'Restore Teacher', login: unique('restorer'), role: 'teacher' });
  await publishFullModule(page, browser, title, 200000 + Math.floor(Math.random() * 100000));

  page.on('dialog', (dialog) => dialog.accept());
  const row = page.locator('#pageContainer > .card > div', { hasText: title });
  await row.getByRole('button', { name: 'O‘chirish' }).click();

  const deleted = page.locator('#deletedModules li', { hasText: title });
  await expect(deleted).toBeVisible();
  await deleted.getByRole('button', { name: 'Tiklash' }).click();

  await expect(page.locator('#deletedModules li', { hasText: title })).toHaveCount(0);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});

test('sidebar and header line up and stay fixed while the page scrolls', async ({ page }) => {
  await register(page, { name: 'Layout Teacher', login: unique('layout'), role: 'teacher' });
  const logoBox = await page.locator('.sidebar-logo').boundingBox();
  const headerBox = await page.locator('.topbar').boundingBox();
  expect(logoBox.y + logoBox.height).toBe(headerBox.y + headerBox.height);

  await page.locator('#pageContainer').evaluate((element) => {
    element.insertAdjacentHTML('beforeend', '<div style="height:3000px"></div>');
    element.scrollTop = 1500;
  });
  expect(await page.locator('#pageContainer').evaluate((element) => element.scrollTop)).toBe(1500);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect((await page.locator('.topbar').boundingBox()).y).toBe(headerBox.y);
  expect((await page.locator('#sidebar').boundingBox()).y).toBe(0);
});

test('AI chat is offered to teachers only, and shows replies as plain text', async ({ browser }) => {
  const studentPage = await (await browser.newContext()).newPage();
  await register(studentPage, { name: 'Chat Student', login: unique('chatstudent'), role: 'student' });
  await expect(studentPage.locator('#aiChatToggle')).toBeHidden();

  const page = await (await browser.newContext()).newPage();
  await register(page, { name: 'Chat Teacher', login: unique('chatteacher'), role: 'teacher' });
  const box = await page.locator('#aiChatToggle').boundingBox();
  const viewport = page.viewportSize();
  expect(box.x + box.width).toBeGreaterThan(viewport.width - 40);
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 40);

  await page.route('**/api/chat', (route) => route.fulfill({ json: { reply: '<img src=x onerror=alert(1)> Tayyor' } }));
  await page.locator('#aiChatToggle').click();
  await page.locator('#aiChatInput').fill('Dars rejasi tuzing');
  await page.locator('#aiChatInput').press('Enter');
  await expect(page.locator('.ai-chat-user')).toHaveText('Dars rejasi tuzing');
  await expect(page.locator('.ai-chat-assistant')).toHaveText('<img src=x onerror=alert(1)> Tayyor');
  await expect(page.locator('.ai-chat-assistant img')).toHaveCount(0);

  await page.unroute('**/api/chat');
  await page.locator('#aiChatInput').fill('Yana savol');
  await page.locator('#aiChatInput').press('Enter');
  await expect(page.locator('.ai-chat-error')).toContainText('sozlanmagan');
  await expect(page.locator('#aiChatInput')).toHaveValue('Yana savol');

  await page.getByRole('button', { name: 'Yopish' }).last().click();
  await expect(page.locator('#aiChatPanel')).toBeHidden();
});

test('a module needs all its materials before it is created', async ({ page }) => {
  await register(page, { name: 'Form Teacher', login: unique('former'), role: 'teacher' });
  await openManage(page);
  await page.locator('#newModOrder').fill(String(400000 + Math.floor(Math.random() * 100000)));
  const title = unique('Tolamagan');
  await page.locator('#newModTitle').fill(title);
  await page.getByRole('button', { name: 'Modulni yaratish' }).click();
  await expect(page.locator('#toast')).toContainText('Diagnostika testini');
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});

for (const width of [1440, 1180, 1000, 768, 390, 340]) {
  test(`public navbar and hero stay aligned at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#navLogin')).toBeVisible();

    const centerY = async (locator) => {
      const box = await locator.boundingBox();
      return box.y + box.height / 2;
    };
    const candidates = [page.locator('#navBrand'), page.locator('#navLogin'), page.locator('#navRegister'),
      page.locator('#mobileMenuBtn'), page.locator('#mainNav a').first()];
    const reference = await centerY(candidates[0]);
    for (const item of candidates) {
      if (await item.isVisible()) expect(Math.abs((await centerY(item)) - reference)).toBeLessThanOrEqual(1);
    }

    const primary = await page.locator('#heroJoin').boundingBox();
    const outline = await page.locator('#heroModules').boundingBox();
    expect(primary.width).toBeCloseTo(outline.width, 0);
    expect(primary.height).toBeCloseTo(outline.height, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(await page.locator('#navbar').evaluate((nav) => nav.scrollWidth - nav.clientWidth)).toBeLessThanOrEqual(0);
  });
}

for (const width of [360, 390]) {
  test(`a ${width}px phone shows sign-in and registration side by side at the top`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#navLogin')).toBeVisible();
    await expect(page.locator('#navRegister')).toBeVisible();
    for (const id of ['#navLogin', '#navRegister']) {
      expect((await page.locator(id).boundingBox()).height).toBeLessThanOrEqual(44);
    }
    expect(await page.locator('#navbar').evaluate((nav) => nav.scrollWidth - nav.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.locator('#mainNav')).toBeHidden();
    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mainNav a').first()).toBeVisible();
    await page.locator('#mobileMenuBtn').click();
    await page.locator('#navRegister').click();
    await expect(page.locator('#authModal')).toHaveClass(ACTIVE);
    await expect(page.locator('#registerForm')).toBeVisible();
  });
}

test('the public site has a footer', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const footer = page.locator('.site-footer');
  await expect(footer).toContainText('Barcha huquqlar himoyalangan');
  await footer.getByRole('link', { name: 'Telegram' }).click();
  expect(new URL(page.url()).hash).toBe('');
});

test('a signed-in visitor stays on the public site after a refresh and is never asked to sign up', async ({ page }) => {
  await register(page, { name: 'Sahifa Egasi', login: unique('stay'), role: 'student' });
  await page.locator('.topbar').getByRole('button', { name: 'Saytga qaytish' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#navUserName')).toBeVisible();
  await expect(page.locator('#screen-app')).not.toHaveClass(ACTIVE);
  await expect(page.locator('#home')).toHaveClass(ACTIVE);

  await page.locator('#mainNav').getByText('Modullar').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#public-modules')).toHaveClass(ACTIVE);
  await expect(page.locator('#navUserName')).toBeVisible();
  await expect(page.getByText('Barcha modullarga kirish')).toHaveCount(0);

  await page.locator('#mainNav').getByText('Bosh sahifa').click();
  await expect(page.locator('#heroJoin')).toContainText('Boshqaruv paneliga o‘tish');
  await page.locator('#heroJoin').click();
  await expect(page.locator('#screen-app')).toHaveClass(ACTIVE);
  await expect(page.locator('#authModal')).not.toHaveClass(ACTIVE);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#screen-app')).toHaveClass(ACTIVE);
  await expect(page.locator('#pageTitle')).toHaveText('Boshqaruv paneli');
});

test('registration needs the emailed code, and a forgotten password can be reset', async ({ page }) => {
  const login = unique('realuser');
  const email = `${login}@gmail.com`;
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#navRegister').click();
  await page.locator('#regName').fill('Real User');
  await page.locator('#regLogin').fill(email);
  await page.locator('#regPass').fill(PASSWORD);
  await page.locator('#registerForm button[type="submit"]').click();
  await expect(page.locator('#registerCodeForm')).toHaveClass(ACTIVE);
  await expect(page.locator('#regResend')).toBeDisabled();

  const code = await emailedCode(page, email);
  await page.locator('#regCode').fill(code === '000000' ? '000001' : '000000');
  await page.locator('#registerCodeForm button[type="submit"]').click();
  await expect(page.locator('#registerCodeError')).toHaveText('Kod noto‘g‘ri.');
  await expect(page.locator('#screen-app')).not.toHaveClass(ACTIVE);

  await page.locator('#regCode').fill(code);
  await page.locator('#registerCodeForm button[type="submit"]').click();
  await expect(page.locator('#screen-app')).toHaveClass(ACTIVE);

  await page.locator('#topbarUser').click();
  await page.getByRole('menuitem', { name: 'Chiqish' }).click();
  await expect(page.locator('#screen-app')).not.toHaveClass(ACTIVE);
  await page.locator('#navLogin').click();
  await page.getByText('Parolni unutdingizmi?').click();
  await page.locator('#forgotEmail').fill(email);
  await page.locator('#forgotForm button[type="submit"]').click();
  await expect(page.locator('#forgotCodeForm')).toHaveClass(ACTIVE);
  await page.locator('#forgotCode').fill(await emailedCode(page, email));
  await page.locator('#forgotPass').fill('a-brand-new-password');
  await page.locator('#forgotCodeForm button[type="submit"]').click();
  await expect(page.locator('#loginForm')).toHaveClass(ACTIVE);
  await expect(page.locator('#loginUser')).toHaveValue(email);
  await page.locator('#loginPass').fill('a-brand-new-password');
  await page.locator('#loginForm button[type="submit"]').click();
  await expect(page.locator('#screen-app')).toHaveClass(ACTIVE);
});

test('the corner label opens the user’s own profile', async ({ page }) => {
  await register(page, { name: 'Profil Egasi', login: unique('profiler'), role: 'teacher' });
  await page.locator('#topbarUser').click();
  await page.getByRole('menuitem', { name: 'Profilim' }).click();
  await expect(page.locator('#pageTitle')).toHaveText('Profilim');
  await expect(page.locator('#profileName')).toHaveText('Profil Egasi');
  await expect(page.locator('.profile-grid')).toContainText('@gmail.com');

  await page.locator('#profileNameInput').fill('Yangi Ism');
  await page.getByRole('button', { name: 'Saqlash', exact: true }).click();
  await expect(page.locator('#profileName')).toHaveText('Yangi Ism');
  await expect(page.locator('#sidebarUser')).toContainText('Yangi Ism');

  await page.locator('#profileCurrentPass').fill('wrong-password');
  await page.locator('#profileNewPass').fill('another-long-password');
  await page.getByRole('button', { name: 'Parolni yangilash' }).click();
  await expect(page.locator('#profilePassError')).toHaveText('Joriy parol noto‘g‘ri.');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#profileName')).toHaveText('Yangi Ism');
});

test('the role chip opens an account menu that works by mouse and keyboard', async ({ page }) => {
  const login = unique('menu');
  await register(page, { name: 'Menyu Egasi', login, role: 'student' });
  await expect(page.locator('#nav-home')).toHaveText('Boshqaruv paneli');
  await expect(page.locator('#sidebar')).not.toContainText('Chiqish');

  const trigger = page.locator('#topbarUser');
  const menu = page.locator('#topbarMenu');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toContainText('Menyu Egasi');
  await expect(menu).not.toContainText('@gmail.com');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();

  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Chiqish' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Profilim' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  // The theme switch lives in the menu only, not as a separate topbar button.
  await expect(page.locator('.topbar [data-theme-toggle]')).toHaveCount(0);
  await expect(page.locator('#navUser [data-theme-toggle]')).toHaveCount(0);
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme || '');
  const before = await theme();
  await trigger.click();
  await menu.locator('.theme-menu-item').click();
  expect(await theme()).not.toBe(before);
  await menu.locator('.theme-menu-item').click();
  await page.keyboard.press('Escape');

  await trigger.click();
  await page.locator('#pageContainer').click({ position: { x: 5, y: 5 } });
  await expect(menu).toBeHidden();

  await trigger.click();
  await expect(menu.getByRole('menuitem')).toHaveText(['Profilim', /rejim$/, 'Chiqish']);
  await page.keyboard.press('Escape');

  await page.locator('.topbar').getByRole('button', { name: 'Saytga qaytish' }).click();
  await expect(page.locator('#screen-app')).not.toHaveClass(ACTIVE);
  await expect(page.locator('#navUser').getByRole('button', { name: 'Chiqish' })).toHaveCount(0);
  await page.locator('#navUserName').click();
  await page.locator('#navMenu').getByRole('menuitem', { name: 'Boshqaruv paneli' }).click();
  await expect(page.locator('#screen-app')).toHaveClass(ACTIVE);
  await expect(page.locator('#pageTitle')).toHaveText('Boshqaruv paneli');

  await page.locator('.topbar').getByRole('button', { name: 'Saytga qaytish' }).click();
  await page.locator('#navUserName').click();
  await page.locator('#navMenu').getByRole('menuitem', { name: 'Chiqish' }).click();
  await expect(page.locator('#navLogin')).toBeVisible();
});

test('the admin dashboard shows how many students and teachers signed up', async ({ page }) => {
  await signIn(page, { ...TEST_ADMIN, role: 'admin' });
  await expect(page.locator('#screen-app')).toHaveClass(ACTIVE);
  await expect(page.locator('#adminTeacherCount')).not.toHaveText('…');
  const { counts } = await (await page.request.get('/api/users?page_size=1')).json();
  await expect(page.locator('#adminStudentCount')).toHaveText(String(counts.student || 0));
  await expect(page.locator('#adminTeacherCount')).toHaveText(String(counts.teacher || 0));

  await page.getByRole('button', { name: /Ro‘yxatdan o‘tgan o‘qituvchilar/ }).click();
  await expect(page.locator('#pageTitle')).toHaveText('Foydalanuvchilar');
  await expect(page.locator('#usersTabTeacher')).toHaveAttribute('aria-pressed', 'true');
});

test('the theme toggle overrides the system and is remembered', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#navAuth [data-theme-toggle]')).toHaveAttribute('aria-label', 'Kunduzgi rejim');
  const dark = await background();

  await page.locator('#navAuth [data-theme-toggle]').click();
  await expect.poll(background).not.toBe(dark);
  const light = await background();
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await background()).toBe(light);

  await page.locator('#navAuth [data-theme-toggle]').click();
  await expect.poll(background).toBe(dark);
  await context.close();
});

test('the phone menu offers the theme toggle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#navAuth [data-theme-toggle]')).toBeHidden();
  await page.locator('#mobileMenuBtn').click();
  await page.locator('.theme-menu-item').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
});

test('staff see step readiness and can preview a module as a student', async ({ page, browser }) => {
  const title = unique('Dars');
  await register(page, { name: 'Lesson Teacher', login: unique('lesson'), role: 'teacher' });
  await publishFullModule(page, browser, title, 400000 + Math.floor(Math.random() * 100000));
  await openMenu(page, 'Modullar');
  await page.locator('.module-card', { hasText: title }).click();

  await expect(page.locator('.step-item.ready')).toHaveCount(6);
  await page.locator('.step-item').nth(1).click();
  await expect(page.locator('#stepHeading')).toHaveText('Video dars');
  await expect(page.locator('#stepModal')).not.toHaveClass(ACTIVE);

  await page.locator('#lessonPreviewBtn').click();
  await expect(page.locator('.step-item.ready')).toHaveCount(0);
  await expect(page.locator('#stepHeading')).toHaveText('Video dars');
});

test('a step without material offers to add it in place', async ({ page, browser }) => {
  const title = unique('Bosh');
  await register(page, { name: 'Empty Teacher', login: unique('empty'), role: 'teacher' });
  await publishFullModule(page, browser, title, 500000 + Math.floor(Math.random() * 100000));
  await page.route('**/api/content?module_id=*', (route) => route.fulfill({ json: [] }));
  await openMenu(page, 'Modullar');
  await page.locator('.module-card', { hasText: title }).click();

  await expect(page.locator('.step-item.missing')).toHaveCount(6);
  await page.locator('#stepBody').getByRole('button', { name: 'Test qo‘shish' }).click();
  await expect(page.locator('#stepModal')).toHaveClass(ACTIVE);
});

test('table headers line up with the values below them', async ({ page, browser }) => {
  await register(page, { name: 'Aligned Student', login: unique('aligned'), role: 'student' });
  const admin = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(admin, { ...TEST_ADMIN, role: 'admin' });
  await openMenu(admin, 'Foydalanuvchilar');
  await expect(admin.locator('.leaderboard-table tbody tr').first()).toBeVisible();

  const offsets = await admin.evaluate(() => {
    const textBox = (cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return range.getBoundingClientRect();
    };
    const headers = [...document.querySelectorAll('.leaderboard-table th')];
    const cells = [...document.querySelector('.leaderboard-table tbody tr').children];
    return headers.map((header, index) => {
      const top = textBox(header);
      const bottom = textBox(cells[index]);
      const left = header.classList.contains('col-left');
      return Math.abs(left ? top.left - bottom.left : (top.left + top.right) / 2 - (bottom.left + bottom.right) / 2);
    });
  });
  expect(Math.max(...offsets)).toBeLessThanOrEqual(1.5);
  await admin.close();
});

test('a phone saves a lesson file through the share sheet and stays on the page', async ({ page, browser }) => {
  const title = unique('Fayl moduli');
  await register(page, { name: 'Share Teacher', login: unique('share'), role: 'teacher' });
  await publishFullModule(page, browser, title, 700000 + Math.floor(Math.random() * 100000));
  await openMenu(page, 'Modullar');
  await page.locator('.module-card', { hasText: title }).click();
  const url = page.url();

  await page.evaluate(() => {
    const realMatch = window.matchMedia.bind(window);
    window.matchMedia = (query) => (query === '(pointer: coarse)' ? { matches: true } : realMatch(query));
    window.sharedFiles = [];
    navigator.canShare = () => true;
    navigator.share = async ({ files }) => { window.sharedFiles.push(files.map((f) => [f.name, f.type, f.size])); };
  });
  await page.locator('.step-item').nth(2).click();
  await page.locator('.file-card').click();
  await expect.poll(() => page.evaluate(() => window.sharedFiles)).toEqual([[['dars.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 4004]]]);
  expect(page.url()).toBe(url);

  // When the browser wants a fresh tap, the card says so and the next tap shares.
  await page.evaluate(() => {
    let first = true;
    navigator.share = async ({ files }) => {
      if (first) { first = false; throw new DOMException('needs a tap', 'NotAllowedError'); }
      window.sharedFiles.push(files.map((f) => f.name));
    };
  });
  await page.locator('.file-card').click();
  await expect(page.locator('.file-card-meta')).toHaveText('Tayyor · saqlash uchun bosing');
  await page.locator('.file-card').click();
  await expect.poll(() => page.evaluate(() => window.sharedFiles.length)).toBe(2);
  await expect(page.locator('.file-card-meta')).toContainText('Yuklab olish');
});

test('content that does not fit on a phone wraps instead of running sideways', async ({ page, browser }) => {
  const title = unique('Juda uzun nomli modul sarlavhasi');
  await register(page, { name: 'Wrap Teacher', login: unique('wrap'), role: 'teacher' });
  await publishFullModule(page, browser, title, 600000 + Math.floor(Math.random() * 100000));
  await openMenu(page, 'Modullar');
  await page.locator('.module-card', { hasText: title }).click();
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.locator('.step-chip')).toHaveCount(6);
  await expect(page.locator('.step-chip').first()).toHaveAttribute('aria-label', /^1-qadam: Diagnostika testi/);

  const overflow = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1;
    return [...document.querySelectorAll('.topbar *, .lesson-strip *, .lesson-content *')]
      .filter((node) => node.getBoundingClientRect().right > limit && !node.closest('iframe'))
      .map((node) => node.tagName + ':' + node.className);
  });
  expect(overflow).toEqual([]);
  const strip = page.locator('.lesson-strip');
  expect(await strip.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
  expect(await page.locator('#pageTitle').evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
});

test('the administrator approves a new teacher from the waiting list', async ({ browser }) => {
  const login = unique('applicant');
  const email = `${login}@gmail.com`;
  const page = await (await browser.newContext()).newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#navRegister').click();
  await page.locator('#registerForm .role-tab[data-role="teacher"]').click();
  await expect(page.locator('#registerForm')).toContainText('administrator tasdiqlaydi');
  await page.locator('#regName').fill('Kutayotgan Ustoz');
  await page.locator('#regLogin').fill(email);
  await page.locator('#regPass').fill(PASSWORD);
  await page.locator('#registerForm button[type="submit"]').click();
  await expect(page.locator('#registerCodeForm')).toHaveClass(ACTIVE);
  await page.locator('#regCode').fill(await emailedCode(page, email));
  await page.locator('#registerCodeForm button[type="submit"]').click();
  await expect(page.locator('#registerPending')).toBeVisible();
  await page.getByRole('button', { name: 'Tushunarli' }).click();

  await signIn(page, { login: email, password: PASSWORD, role: 'teacher' });
  await expect(page.locator('#loginError')).toContainText('tasdig‘ini kutmoqda');
  await expect(page.locator('#screen-app')).not.toHaveClass(ACTIVE);

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, { ...TEST_ADMIN, role: 'admin' });
  await admin.locator('#adminPendingCount').click();
  await expect(admin.locator('#usersTabPending')).toHaveAttribute('aria-pressed', 'true');
  const row = admin.locator('#usersTable tr', { hasText: email });
  await row.getByRole('button', { name: 'Tasdiqlash' }).click();
  await expect(admin.locator('#toast')).toContainText('tasdiqlandi');
  await expect(admin.locator('#usersTable tr', { hasText: email })).toHaveCount(0);

  await page.locator('#loginForm button[type="submit"]').click();
  await expect(page.locator('#screen-app')).toHaveClass(ACTIVE);
});

test('a teacher sees another teacher’s module but cannot change it', async ({ browser }) => {
  const title = unique('Begona');
  const owner = await (await browser.newContext()).newPage();
  await register(owner, { name: 'Owner Teacher', login: unique('owner'), role: 'teacher' });
  await publishFullModule(owner, browser, title, 800000 + Math.floor(Math.random() * 100000));

  const other = await (await browser.newContext()).newPage();
  await register(other, { name: 'Other Teacher', login: unique('other'), role: 'teacher' });
  await openManage(other);
  const row = other.locator('#pageContainer > .card > div', { hasText: title });
  await expect(row).toContainText('Boshqa o‘qituvchining moduli');
  await expect(row.getByRole('button', { name: 'O‘chirish' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Tahrirlash' })).toHaveCount(0);

  await openMenu(other, 'Modullar');
  await other.locator('.module-card', { hasText: title }).click();
  await expect(other.locator('#stepBody')).toBeVisible();
  await expect(other.locator('#lessonPreviewBtn')).toHaveCount(0);
  await expect(other.locator('.lesson-content')).toContainText('boshqa o‘qituvchi yaratgan');
  await expect(other.locator('.step-item.ready')).toHaveCount(0);
});

test('browser errors reach the administrator’s error log', async ({ browser }) => {
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/', { waitUntil: 'load' });
  const message = `E2E sinov xatosi ${Date.now()}`;
  const sent = visitor.waitForResponse((response) => response.url().endsWith('/api/errors') && response.status() === 202);
  await visitor.evaluate((text) => window.dispatchEvent(new ErrorEvent('error', { message: text, error: new Error(text) })), message);
  await sent;

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, { ...TEST_ADMIN, role: 'admin' });
  await openMenu(admin, 'Xatolar jurnali');
  await expect(admin.locator('.error-entry', { hasText: message })).toContainText('Brauzer');
});

test('the file field is in Uzbek and names the chosen file', async ({ page }) => {
  await register(page, { name: 'Picker Teacher', login: unique('picker'), role: 'teacher' });
  await openManage(page);
  const box = page.locator('label[for="newPresFile"]');
  await expect(box).toContainText('Fayl tanlang');
  await page.locator('#newPresFile').setInputFiles(file('dars.pptx', PPTX));
  await expect(box).toContainText('dars.pptx');
  await expect(box).toContainText('Almashtirish');
  await expect(page.getByText('Choose File')).toHaveCount(0);
});

test('legal pages, search metadata and a strict content policy', async ({ page }) => {
  const violations = [];
  page.on('console', (message) => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /olti qadamli modullar/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og-image\.jpg$/);
  expect((await page.request.get('/robots.txt')).ok()).toBe(true);
  expect((await page.request.get('/og-image.jpg')).ok()).toBe(true);

  await page.locator('.site-footer').getByRole('link', { name: 'Maxfiylik siyosati' }).first().click();
  await expect(page.locator('#privacy')).toHaveClass(ACTIVE);
  await expect(page.locator('#privacy h1')).toHaveText('Maxfiylik siyosati');
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#privacy')).toHaveClass(ACTIVE);
  await page.locator('.site-footer').getByRole('link', { name: 'Foydalanish shartlari' }).click();
  await expect(page.locator('#terms h1')).toHaveText('Foydalanish shartlari');
  expect(violations).toEqual([]);
});

test('a question from the contact form is sent to the platform inbox', async ({ page }) => {
  const email = `${unique('savol')}@example.com`;
  await page.goto('/#public-contact', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#public-contact')).toContainText('uzforedu@gmail.com');
  await page.locator('#contactName').fill('Savol Beruvchi');
  await page.locator('#contactEmail').fill(email);
  await page.locator('#contactMessage').fill('Sertifikat beriladimi?');
  await page.getByRole('button', { name: 'Savolni yuborish' }).click();
  await expect(page.locator('#contactSent')).toContainText('Savolingiz yuborildi');
  const { message } = await (await page.request.get(`/__test/mail?to=${encodeURIComponent(`contact:${email}`)}`)).json();
  expect(message).toMatchObject({ to: 'uzforedu@gmail.com', email, message: 'Sertifikat beriladimi?' });
});
