const { expect, test } = require('@playwright/test');
const { TEST_ADMIN } = require('../helpers/harness');

const PASSWORD = 'a-valid-password';
const PPTX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(4000, 9)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(2000, 1)]);
const file = (name, buffer, mimeType = 'application/octet-stream') => ({ name, mimeType, buffer });

let counter = 0;
const unique = (prefix) => `${prefix}_${Date.now()}_${++counter}`;

async function register(page, { name, login, role }) {
  await page.goto('/');
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
  await page.goto('/');
  await page.locator('#navAuth .btn-primary').click();
  await page.locator(`#loginForm .role-tab[data-role="${role}"]`).click();
  await page.locator('#loginUser').fill(login);
  await page.locator('#loginPass').fill(password);
  await page.locator('#loginForm button[type="submit"]').click();
}

const openMenu = (page, title) => page.locator('#sidebarNav .nav-item', { hasText: title }).click();

async function createModule(page, title, order) {
  await openMenu(page, 'Modullarni boshqarish');
  await page.locator('#newModOrder').fill(String(order));
  await page.locator('#newModTitle').fill(title);
  await page.getByRole('button', { name: 'Modulni yaratish' }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function attach(page, moduleTitle, buttonName, fill) {
  const card = page.locator('#pageContainer > .card > div', { hasText: moduleTitle });
  await card.getByRole('button', { name: buttonName }).click();
  await expect(page.locator('#teacherSaveBtn')).toBeVisible();
  await fill(page);
  await page.locator('#teacherSaveBtn').click();
  await expect(page.locator('#stepModal')).not.toHaveClass(/active/);
}

async function publishFullModule(page, title, order) {
  await createModule(page, title, order);
  await attach(page, title, 'Test savoli', async (p) => {
    await p.locator('#teacherUploadVal').fill('Didaktika qaysi fan sohasi?');
    await p.locator('#teacherUploadVal2').fill('pedagogika');
  });
  await attach(page, title, 'Video (URL)', (p) => p.locator('#teacherUploadVal').fill('https://www.youtube.com/watch?v=aaaaaaaaaaa'));
  await attach(page, title, 'Taqdimot', (p) => p.locator('#teacherUploadFile').setInputFiles(file('dars.pptx', PPTX)));
  await attach(page, title, 'Qo‘shimcha matn', (p) => p.locator('#teacherUploadFile').setInputFiles(file('qollanma.pdf', PDF)));
  await attach(page, title, 'Topshiriq', (p) => p.locator('#teacherUploadVal').fill('Dars rejasini tuzing'));
  await attach(page, title, 'Refleksiya', (p) => p.locator('#teacherUploadVal').fill('Nimani o‘rgandingiz?'));
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
    await publishFullModule(teacherPage, moduleTitle, 1000 + Math.floor(Math.random() * 100000));
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

    await doStep(studentPage, 0, (p) => p.locator('#stepAnswer').fill('Pedagogika'));
    await expect(studentPage.locator('#toast')).toContainText('To‘g‘ri javob');
    await doStep(studentPage, 1);
    await doStep(studentPage, 2);
    await doStep(studentPage, 3);
    await doStep(studentPage, 4, async (p) => {
      await p.locator('#stepResponse').fill('Mening rejam');
      await p.locator('#stepFile').setInputFiles(file('javob.pdf', PDF));
    });
    await doStep(studentPage, 5, (p) => p.locator('#stepResponse').fill('Ko‘p narsa o‘rgandim'));
    await expect(studentPage.locator('.celebration-box')).toBeVisible();
  });

  await test.step('the teacher opens the student from the leaderboard', async () => {
    await openMenu(teacherPage, 'Modullar ko‘rinishi');
    await openMenu(teacherPage, 'Tahlil va Grafika');
    await teacherPage.getByRole('button', { name: studentName }).click();
    const work = teacherPage.locator('.work-module', { hasText: moduleTitle });
    await expect(work.getByText('Mening rejam')).toBeVisible();
    await expect(work.getByText('javob.pdf')).toBeVisible();
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

test('a deleted module can be restored', async ({ page }) => {
  const title = unique('Tiklanadigan');
  await register(page, { name: 'Restore Teacher', login: unique('restorer'), role: 'teacher' });
  await createModule(page, title, 200000 + Math.floor(Math.random() * 100000));

  page.on('dialog', (dialog) => dialog.accept());
  const row = page.locator('#pageContainer > .card > div', { hasText: title });
  await row.getByRole('button', { name: 'O‘chirish' }).click();

  const deleted = page.locator('#deletedModules li', { hasText: title });
  await expect(deleted).toBeVisible();
  await deleted.getByRole('button', { name: 'Tiklash' }).click();

  await expect(page.locator('#deletedModules li', { hasText: title })).toHaveCount(0);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});
