const { expect, test } = require('@playwright/test');
const { TEST_ADMIN } = require('../helpers/harness');

const PASSWORD = 'a-valid-password';
const PPTX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(4000, 9)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(2000, 1)]);
const file = (name, buffer, mimeType = 'application/octet-stream') => ({ name, mimeType, buffer });

let counter = 0;
const unique = (prefix) => `${prefix}_${Date.now()}_${++counter}`;

async function register(page, { name, login, role }) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#navAuth .btn-nav').click();
  await page.locator(`#registerForm .role-tab[data-role="${role}"]`).click();
  await page.locator('#regName').fill(name);
  await page.locator('#regLogin').fill(login);
  await page.locator('#regPass').fill(PASSWORD);
  await page.locator('#registerForm button[type="submit"]').click();
  await expect(page.locator('#screen-app')).toHaveClass(/active/);
  await expect(page.locator('#pageTitle')).toHaveText('Bosh sahifa');
}

async function signIn(page, { login, password, role }) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#navAuth .btn-primary').click();
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
  await openMenu(page, 'Modullarni boshqarish');
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
  await expect(page.locator('#stepModal')).toHaveClass(/active/);
  if (fill) await fill(page);
  await page.locator('#modalFooter button').first().click();
  await expect(page.locator('#stepModal')).not.toHaveClass(/active/);
}

test('a wrong password shows an error and never enters the app', async ({ page }) => {
  await signIn(page, { login: 'nobody_here', password: 'wrong-password', role: 'admin' });
  await expect(page.locator('#loginError')).toHaveText('Login yoki parol noto‘g‘ri.');
  await expect(page.locator('#screen-app')).not.toHaveClass(/active/);
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
    await openMenu(teacherPage, 'Modullar ko‘rinishi');
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
  await openMenu(page, 'Modullarni boshqarish');
  await page.locator('#newModOrder').fill(String(400000 + Math.floor(Math.random() * 100000)));
  const title = unique('Tolamagan');
  await page.locator('#newModTitle').fill(title);
  await page.getByRole('button', { name: 'Modulni yaratish' }).click();
  await expect(page.locator('#toast')).toContainText('Diagnostika testini');
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});
