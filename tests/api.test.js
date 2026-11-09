const assert = require('node:assert/strict');
const { before, describe, test } = require('node:test');
const { TEST_ADMIN, createHarness } = require('./helpers/harness');

const PPTX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100, 7)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(100, 1)]);

let harness, admin, teacher, student, other;
let moduleId;
let sequence = 0;
const unique = (prefix) => `${prefix}_${++sequence}`;

async function addModule(by) {
  const res = await by.post('modules', { order_num: 100 + (++sequence), title: 'Module', description: 'About' });
  assert.equal(res.statusCode, 200);
  return res.body.id;
}

async function addContent(by, id, step, content) {
  const res = await by.post('content', { module_id: id, step_type: step, content });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res;
}

async function buildFullModule(by) {
  const id = await addModule(by);
  await addContent(by, id, 'diag', { value: 'Question?', answer: "To'g'ri" });
  await addContent(by, id, 'video', { value: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
  for (const step of ['pres', 'doc']) {
    const file = await by.upload({ moduleId: id, stepType: step, purpose: 'content', filename: `${step}.pptx`, bytes: PPTX });
    assert.equal(file.statusCode, 200, JSON.stringify(file.body));
    await addContent(by, id, step, { value: '', file_id: file.body.id });
  }
  await addContent(by, id, 'task', { value: 'Do the task' });
  await addContent(by, id, 'refl', { value: 'Reflect' });
  return id;
}

const finishUntilTask = async (by, id) => {
  await by.post('progress', { module_id: id, step_type: 'diag', response: 'wrong' });
  for (const step of ['video', 'pres', 'doc']) {
    assert.equal((await by.post('progress', { module_id: id, step_type: step, response: '' })).statusCode, 200);
  }
};

before(async () => {
  harness = await createHarness();
  harness.stubMail();
  admin = harness.client();
  assert.equal((await admin.login(TEST_ADMIN.login, TEST_ADMIN.password)).statusCode, 200);
  teacher = harness.client();
  assert.equal((await teacher.register('teacher_one', 'teacher')).body.role, 'teacher');
  student = harness.client();
  assert.equal((await student.register('student_one', 'student')).body.role, 'student');
  other = harness.client();
  await other.register('student_two');
  moduleId = await buildFullModule(teacher);
});

describe('database setup', () => {
  test('row level security is on for every table', async () => {
    const open = await harness.sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'np%' AND NOT rowsecurity`;
    assert.deepEqual(open, []);
  });
});

describe('registration and login', () => {
  test('nobody can self-register as admin', async () => {
    assert.equal((await harness.client().register(unique('hacker'), 'admin')).statusCode, 400);
  });

  test('a wrong password returns 401 and the account locks after five attempts', async () => {
    const login = unique('locked');
    await harness.client().register(login);
    const visitor = harness.client();
    for (let i = 0; i < 5; i++) assert.equal((await visitor.login(login, 'wrong-password')).statusCode, 401);
    assert.equal((await visitor.login(login, 'a-valid-password')).statusCode, 429);
  });

  test('blocking an account ends its existing session at once', async () => {
    const login = unique('blocked');
    const person = harness.client();
    await person.register(login);
    assert.equal((await person.get('auth')).body.user.login, `${login}@gmail.com`);
    await harness.sql`UPDATE np_users SET status='blocked' WHERE login=${`${login}@gmail.com`}`;
    assert.equal((await person.get('auth')).body.user, null);
  });

  test('logout invalidates the session on the server', async () => {
    const person = harness.client();
    await person.register(unique('leaver'));
    const cookieBefore = await person.get('auth');
    assert.ok(cookieBefore.body.user);
    await person.post('auth', { action: 'logout' });
    assert.equal((await person.get('auth')).body.user, null);
  });

  test('old demo accounts and plaintext passwords are cleaned by setup', async () => {
    await harness.sql`INSERT INTO np_users(name, login, password, role) VALUES('Bosh Oqituvchi', 'teacher', 'teacher123', 'teacher')`;
    await harness.sql`INSERT INTO np_users(name, login, password, role) VALUES('Real Person', 'old_user', 'legacy-plain', 'student')`;
    const { createResponse } = require('./helpers/harness');
    const res = createResponse();
    await harness.handlers.setup({ method: 'POST', headers: { authorization: `Bearer ${process.env.SETUP_SECRET}` } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal((await harness.client().login('teacher', 'teacher123')).statusCode, 401);
    const [demo] = await harness.sql`SELECT deleted_at FROM np_users WHERE login='teacher'`;
    assert.ok(demo.deleted_at);
    const [migrated] = await harness.sql`SELECT password FROM np_users WHERE login='old_user'`;
    assert.match(migrated.password, /^scrypt\$/);
    assert.equal((await harness.client().login('old_user', 'legacy-plain')).statusCode, 200);
  });
});

describe('progress and grading', () => {
  test('the test answer is hidden from students and graded on the server', async () => {
    const content = await student.get('content', { module_id: moduleId });
    assert.equal(content.body.find((row) => row.step_type === 'diag').content.answer, undefined);
    const res = await student.post('progress', { module_id: moduleId, step_type: 'diag', response: 'to‘g‘ri' });
    assert.equal(res.body.step_responses.diag_correct, true);
    assert.equal(res.body.total_score, 15);
  });

  test('steps cannot be skipped', async () => {
    const res = await other.post('progress', { module_id: moduleId, step_type: 'pres', response: '' });
    assert.equal(res.statusCode, 409);
  });

  test('the first teacher review is saved and a later one keeps it', async () => {
    const id = await buildFullModule(teacher);
    await finishUntilTask(student, id);
    const done = await student.post('progress', { module_id: id, step_type: 'task', response: 'My work' });
    const first = await teacher.post('progress', { action: 'review', progress_id: done.body.id, step: 'task', feedback: 'Good' });
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.step_responses.reviews.task.feedback, 'Good');
    const refl = await student.post('progress', { module_id: id, step_type: 'refl', response: 'Thoughts' });
    const second = await teacher.post('progress', { action: 'review', progress_id: refl.body.id, step: 'refl', feedback: 'Deep' });
    assert.equal(second.body.step_responses.reviews.task.feedback, 'Good');
    assert.equal(second.body.step_responses.reviews.refl.feedback, 'Deep');
  });

  test('a review of a missing submission is a 404, and students cannot review', async () => {
    assert.equal((await teacher.post('progress', { action: 'review', progress_id: 999999, step: 'task', feedback: 'x' })).statusCode, 404);
    assert.equal((await student.post('progress', { action: 'review', progress_id: 1, step: 'task', feedback: 'x' })).statusCode, 403);
  });

  test('a teacher can read one student by id; a student cannot read another', async () => {
    const [row] = await harness.sql`SELECT id FROM np_users WHERE login='student_one@gmail.com'`;
    const seen = await teacher.get('progress', { user_id: row.id });
    assert.ok(seen.body.length > 0);
    assert.ok(seen.body.every((item) => item.user_id === row.id && item.student_name));
    assert.equal((await other.get('progress', { user_id: row.id })).statusCode, 403);
  });
});

describe('file uploads', () => {
  test('a presentation must be a real pptx', async () => {
    const id = await addModule(teacher);
    const wrongExtension = await teacher.upload({ moduleId: id, stepType: 'pres', purpose: 'content', filename: 'a.pdf', bytes: PDF });
    assert.equal(wrongExtension.statusCode, 415);
    const disguised = await teacher.upload({ moduleId: id, stepType: 'pres', purpose: 'content', filename: 'a.pptx', bytes: PDF });
    assert.equal(disguised.statusCode, 415);
    assert.equal((await teacher.post('content', { module_id: id, step_type: 'pres', content: { value: '' } })).statusCode, 400);
  });

  test('students cannot upload module materials', async () => {
    const res = await student.upload({ moduleId, stepType: 'doc', purpose: 'content', filename: 'a.pdf', bytes: PDF });
    assert.equal(res.statusCode, 403);
  });

  test('a large file round-trips exactly through chunks', async () => {
    const id = await addModule(teacher);
    const bytes = Buffer.concat([PPTX, Buffer.alloc(7 * 1024 * 1024, 42)]);
    const up = await teacher.upload({ moduleId: id, stepType: 'pres', purpose: 'content', filename: 'big.pptx', bytes });
    assert.equal(up.statusCode, 200, JSON.stringify(up.body));
    const meta = await student.get('files', { id: up.body.id });
    assert.equal(meta.body.total_chunks, 3);
    const parts = [];
    for (let chunk = 0; chunk < meta.body.total_chunks; chunk++) {
      const res = await student.get('files', { id: up.body.id, chunk: String(chunk) });
      assert.ok(res.body.data.length < 4.5e6);
      parts.push(Buffer.from(res.body.data, 'base64'));
    }
    assert.ok(Buffer.concat(parts).equals(bytes));
  });

  test('an incomplete upload cannot be finished, and oversize files are refused', async () => {
    const id = await addModule(teacher);
    const init = await teacher.post('files', { action: 'init', module_id: id, step_type: 'doc', purpose: 'content', filename: 'a.pdf', size: 10 });
    assert.equal((await teacher.post('files', { action: 'complete', id: init.body.id })).statusCode, 409);
    const big = await teacher.post('files', { action: 'init', module_id: id, step_type: 'doc', purpose: 'content', filename: 'a.pdf', size: 31 * 1024 * 1024 });
    assert.equal(big.statusCode, 413);
  });

  test('replacing a material deletes the previous file', async () => {
    const id = await addModule(teacher);
    const first = await teacher.upload({ moduleId: id, stepType: 'doc', purpose: 'content', filename: 'one.pdf', bytes: PDF });
    await addContent(teacher, id, 'doc', { value: '', file_id: first.body.id });
    const second = await teacher.upload({ moduleId: id, stepType: 'doc', purpose: 'content', filename: 'two.pdf', bytes: PDF });
    await addContent(teacher, id, 'doc', { value: '', file_id: second.body.id });
    assert.equal((await teacher.get('files', { id: first.body.id })).statusCode, 404);
    assert.equal((await teacher.get('files', { id: second.body.id })).statusCode, 200);
  });

  test('a student file is private to its owner and staff', async () => {
    const id = await buildFullModule(teacher);
    await finishUntilTask(student, id);
    const up = await student.upload({ moduleId: id, stepType: 'task', purpose: 'submission', filename: 'answer.pdf', bytes: PDF });
    assert.equal(up.statusCode, 200, JSON.stringify(up.body));
    const done = await student.post('progress', { module_id: id, step_type: 'task', response: '', file_id: up.body.id });
    assert.equal(done.statusCode, 200, JSON.stringify(done.body));
    assert.equal(done.body.step_responses.task_file.name, 'answer.pdf');

    assert.equal((await other.get('files', { id: up.body.id })).statusCode, 404);
    assert.equal((await harness.client().get('files', { id: up.body.id })).statusCode, 401);
    assert.equal((await teacher.get('files', { id: up.body.id })).statusCode, 200);
    assert.equal((await student.get('files', { id: up.body.id })).statusCode, 200);
  });

  test("another student's file cannot be attached", async () => {
    const id = await buildFullModule(teacher);
    await finishUntilTask(student, id);
    await finishUntilTask(other, id);
    const up = await student.upload({ moduleId: id, stepType: 'task', purpose: 'submission', filename: 'a.pdf', bytes: PDF });
    const stolen = await other.post('progress', { module_id: id, step_type: 'task', response: '', file_id: up.body.id });
    assert.equal(stolen.statusCode, 400);
  });

  test('a task needs text or a file', async () => {
    const id = await buildFullModule(teacher);
    await finishUntilTask(student, id);
    assert.equal((await student.post('progress', { module_id: id, step_type: 'task', response: '' })).statusCode, 400);
  });
});

describe('admin user directory', () => {
  test('only admins can list users', async () => {
    assert.equal((await teacher.get('users')).statusCode, 403);
    assert.equal((await student.get('users')).statusCode, 403);
    assert.equal((await harness.client().get('users')).statusCode, 401);
  });

  test('new registrations appear with the right role and no password', async () => {
    const list = await admin.get('users', { role: 'teacher', q: 'teacher_one' });
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0].role, 'teacher');
    assert.equal(list.body.items[0].password, undefined);
    assert.ok(list.body.items[0].modules_created > 0);
    assert.ok(list.body.counts.student >= 2);
  });

  test('search treats % as plain text and pagination is bounded', async () => {
    assert.equal((await admin.get('users', { q: '%' })).body.total, 0);
    assert.equal((await admin.get('users', { page_size: '5000' })).body.page_size, 100);
  });

  test('a profile shows the account and its modules, without the password', async () => {
    const [row] = await harness.sql`SELECT id FROM np_users WHERE login='teacher_one@gmail.com'`;
    const profile = await admin.get('users', { id: String(row.id) });
    assert.equal(profile.body.login, 'teacher_one@gmail.com');
    assert.equal(profile.body.password, undefined);
    assert.ok(profile.body.modules_created.length > 0);
    assert.equal((await admin.get('users', { id: '999999' })).statusCode, 404);
  });
});

describe('registration limit', () => {
  const attempt = (ip) => harness.client().call('auth', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: { action: 'register_start', name: 'Some Name', email: `${unique('limited')}@gmail.com`, password: 'a-valid-password' }
  });

  test('one address is stopped after ten code requests, others are not', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await attempt('203.0.113.7')).statusCode, 200);
    assert.equal((await attempt('203.0.113.7')).statusCode, 429);
    assert.equal((await attempt('203.0.113.8')).statusCode, 200);
  });
});

describe('gmail verification', () => {
  const start = (by, email, extra = {}) => by.post('auth', { action: 'register_start', name: 'Real Person', email, password: 'a-valid-password', ...extra });
  const verify = (by, email, code) => by.post('auth', { action: 'register_verify', email, code });
  const lastCode = (email) => harness.outbox.findLast((item) => item.to === email && item.code)?.code;
  const expireCooldown = (email) => harness.sql`UPDATE np_email_codes SET last_sent_at = NOW() - INTERVAL '2 minutes' WHERE email=${email}`;
  const wrong = (code) => (code === '000000' ? '000001' : '000000');

  test('only gmail addresses are accepted', async () => {
    assert.equal((await start(harness.client(), 'someone@yahoo.com')).statusCode, 400);
    assert.equal((await start(harness.client(), 'not-an-email')).statusCode, 400);
  });

  test('no account exists until the code is confirmed', async () => {
    const email = `${unique('pending')}@gmail.com`;
    const person = harness.client();
    assert.equal((await start(person, email)).statusCode, 200);
    assert.equal((await harness.sql`SELECT 1 FROM np_users WHERE login=${email}`).length, 0);
    assert.equal((await person.get('auth')).body.user, null);
    assert.equal((await verify(person, email, wrong(lastCode(email)))).statusCode, 400);
    const done = await verify(person, email, lastCode(email));
    assert.equal(done.statusCode, 201);
    assert.equal((await person.get('auth')).body.user.login, email);
  });

  test('a code stops working after five wrong tries and after use', async () => {
    const email = `${unique('guess')}@gmail.com`;
    const person = harness.client();
    await start(person, email);
    const code = lastCode(email);
    for (let i = 0; i < 5; i++) assert.equal((await verify(person, email, wrong(code))).statusCode, 400);
    assert.match((await verify(person, email, code)).body.error, /eskirgan/);
  });

  test('an expired code is refused and the password is never stored in plain text', async () => {
    const email = `${unique('late')}@gmail.com`;
    const person = harness.client();
    await start(person, email);
    const [row] = await harness.sql`SELECT payload, code_hash FROM np_email_codes WHERE email=${email}`;
    assert.match(row.payload.password, /^scrypt\$/);
    assert.notEqual(row.code_hash, lastCode(email));
    await harness.sql`UPDATE np_email_codes SET expires_at = NOW() - INTERVAL '1 minute' WHERE email=${email}`;
    assert.equal((await verify(person, email, lastCode(email))).statusCode, 400);
  });

  test('a new code must wait a minute', async () => {
    const email = `${unique('resend')}@gmail.com`;
    await start(harness.client(), email);
    assert.equal((await start(harness.client(), email)).statusCode, 429);
    await expireCooldown(email);
    assert.equal((await start(harness.client(), email)).statusCode, 200);
  });

  test('dots and +tags cannot create a second account for one mailbox', async () => {
    const base = unique('mailbox').replace(/_/g, '');
    const email = `${base}@gmail.com`;
    await start(harness.client(), email);
    assert.equal((await verify(harness.client(), email, lastCode(email))).statusCode, 201);
    const variant = `${base.slice(0, 3)}.${base.slice(3)}+x@gmail.com`;
    const again = await start(harness.client(), variant);
    assert.equal(again.statusCode, 200);
    assert.equal(harness.outbox.at(-1).notice, true);
  });

  test('registering an existing mailbox reveals nothing and never gives a working code', async () => {
    const name = unique('owner');
    await harness.client().register(name);
    const email = `${name}@gmail.com`;
    await expireCooldown(email);
    const res = await start(harness.client(), email, { role: 'teacher' });
    assert.deepEqual(res.body, { ok: true, email });
    assert.equal((await verify(harness.client(), email, '123456')).statusCode, 400);
  });

  test('a mail failure is reported and leaves no pending code', async () => {
    const mail = require('../api/_mail');
    const saved = mail.sendCode;
    mail.sendCode = async () => { throw new Error('smtp down'); };
    const email = `${unique('nomail')}@gmail.com`;
    const res = await start(harness.client(), email);
    mail.sendCode = saved;
    assert.equal(res.statusCode, 503);
    assert.equal((await harness.sql`SELECT 1 FROM np_email_codes WHERE email=${email}`).length, 0);
  });

  test('without mail settings production refuses instead of skipping verification', async () => {
    delete require.cache[require.resolve('../api/_mail')];
    const real = require('../api/_mail');
    delete process.env.GMAIL_USER;
    delete process.env.LOCAL_DEV_MAIL;
    await assert.rejects(real.sendCode('a@gmail.com', '123456', 'register'), real.MailNotConfiguredError);
  });

  test('a password reset changes the password and ends old sessions', async () => {
    const name = unique('forgetful');
    const person = harness.client();
    await person.register(name);
    const email = `${name}@gmail.com`;
    const visitor = harness.client();
    assert.equal((await visitor.post('auth', { action: 'reset_start', email })).statusCode, 200);
    const code = lastCode(email);
    const weak = await visitor.post('auth', { action: 'reset_verify', email, code, password: 'short' });
    assert.equal(weak.statusCode, 400);
    assert.equal((await visitor.post('auth', { action: 'reset_verify', email, code, password: 'brand-new-password' })).statusCode, 200);
    assert.equal((await person.get('auth')).body.user, null);
    assert.equal((await visitor.login(email, 'a-valid-password')).statusCode, 401);
    assert.equal((await visitor.login(email, 'brand-new-password')).statusCode, 200);
  });

  test('a reset for an unknown mailbox answers the same and sends nothing', async () => {
    const email = `${unique('ghost')}@gmail.com`;
    const before = harness.outbox.length;
    const res = await harness.client().post('auth', { action: 'reset_start', email });
    assert.equal(res.statusCode, 200);
    assert.equal(harness.outbox.length, before);
    assert.equal((await harness.client().post('auth', { action: 'reset_verify', email, code: '123456', password: 'brand-new-password' })).statusCode, 400);
  });
});

describe('module deletion', () => {
  test('deleting hides the module but keeps student work until restored', async () => {
    const id = await buildFullModule(teacher);
    await finishUntilTask(other, id);

    assert.equal((await teacher.call('modules', { method: 'DELETE', query: { id: String(id) } })).statusCode, 200);
    assert.ok(!(await student.get('modules')).body.some((m) => m.id === id));
    assert.equal((await student.get('content', { module_id: String(id) })).body.length, 0);
    assert.equal((await other.post('progress', { module_id: id, step_type: 'task', response: 'x' })).statusCode, 404);
    assert.equal((await student.get('modules', { deleted: '1' })).statusCode, 403);
    assert.ok((await teacher.get('modules', { deleted: '1' })).body.some((m) => m.id === id));

    assert.equal((await teacher.post('modules', { action: 'restore', id })).statusCode, 200);
    const rows = await other.get('progress', { module_id: String(id) });
    assert.equal(rows.body[0].completed_steps.length, 4);
  });

  test('a position freed by deletion can be reused, and restoring into it conflicts', async () => {
    const first = await teacher.post('modules', { order_num: 777, title: 'First' });
    await teacher.call('modules', { method: 'DELETE', query: { id: String(first.body.id) } });
    const second = await teacher.post('modules', { order_num: 777, title: 'Second' });
    assert.equal(second.statusCode, 200);
    assert.equal((await teacher.post('modules', { action: 'restore', id: first.body.id })).statusCode, 409);
  });
});

describe('AI chat', () => {
  const llm = require('../api/_llm');
  const original = llm.askAssistant;
  const ask = (by, messages) => by.post('chat', { messages });
  const hello = [{ role: 'user', content: 'Salom' }];

  test('only teachers and admins may use it', async () => {
    assert.equal((await ask(harness.client(), hello)).statusCode, 401);
    assert.equal((await ask(student, hello)).statusCode, 403);
  });

  test('a missing API key is reported instead of a made-up answer', async () => {
    const saved = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    const res = await ask(teacher, hello);
    if (saved) process.env.GROQ_API_KEY = saved;
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /sozlanmagan/);
  });

  test('malformed conversations are rejected before reaching the model', async () => {
    let calls = 0;
    llm.askAssistant = async () => { calls++; return 'x'; };
    for (const bad of [[], 'text', [{ role: 'assistant', content: 'x' }], [{ role: 'system', content: 'x' }],
      [{ role: 'user', content: 'a'.repeat(8001) }], [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]]) {
      assert.equal((await ask(teacher, bad)).statusCode, 400);
    }
    llm.askAssistant = original;
    assert.equal(calls, 0);
  });

  test('admin gets the reply and only the chat text is sent to the model', async () => {
    let received;
    llm.askAssistant = async (messages) => { received = messages; return 'Javob'; };
    const res = await ask(admin, [...hello.map((m) => ({ ...m, extra: 'dropped' }))]);
    llm.askAssistant = original;
    assert.equal(res.body.reply, 'Javob');
    assert.deepEqual(received, [{ role: 'user', content: 'Salom' }]);
  });

  test('each user is limited per hour', async () => {
    const heavy = harness.client();
    await heavy.register(unique('chatty'), 'teacher');
    llm.askAssistant = async () => 'ok';
    for (let i = 0; i < 40; i++) assert.equal((await ask(heavy, hello)).statusCode, 200);
    const blocked = await ask(heavy, hello);
    llm.askAssistant = original;
    assert.equal(blocked.statusCode, 429);
  });
});

describe('diagnostic tests', () => {
  const { gradeAnswers, parseTests, studentPaper } = require('../api/_quiz');
  const llm = require('../api/_llm');
  const zlib = require('node:zlib');

  // Smallest valid .docx: an uncompressed zip holding one document part.
  function makeDocx(paragraphs) {
    const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('');
    const parts = [
      ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`]
    ];
    const local = [];
    const central = [];
    let offset = 0;
    for (const [name, text] of parts) {
      const data = Buffer.from(text);
      const crc = zlib.crc32(data);
      const nameBytes = Buffer.from(name);
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14);
      header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26);
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc, 16);
      entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42);
      local.push(header, nameBytes, data);
      central.push(entry, nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const centralBytes = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10);
    end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, centralBytes, end]);
  }

  const makeQuestions = (n) => Array.from({ length: n }, (_, i) => ({
    text: `Savol ${i + 1}`,
    options: [`togri ${i + 1}`, `xato a ${i + 1}`, `xato b ${i + 1}`, `xato c ${i + 1}`],
    correct: 0
  }));

  async function uploadSource(by, filename, bytes) {
    return by.upload({ stepType: 'diag', purpose: 'quiz_source', filename, bytes });
  }

  test('the parser reads star marks, answer keys, one-line options and wrapped text', () => {
    assert.deepEqual(parseTests('Fan testlari\n1. Poytaxt qaysi?\nA) Samarqand\n*B) Toshkent\nC) Buxoro\n2) Ikki\nkarra ikki?\nA. uch\nB. to‘rt +').map((q) => q.correct), [1, 1]);
    const wrapped = parseTests('1. Ikki\nkarra ikki?\nA. uch\nB. to‘rt +');
    assert.equal(wrapped[0].text, 'Ikki karra ikki?');
    assert.deepEqual(parseTests('1. Bir?\nA) x\nB) y\n2. Ikki?\nA) m  B) n\nJavoblar\n1-B 2-A').map((q) => q.correct), [1, 0]);
    assert.equal(parseTests('1. Bir?\nA) x\nB) y')[0].correct, null);
    assert.deepEqual(parseTests('Bu oddiy matn. Unda test yo‘q.\nYana bir jumla.'), []);
  });

  test('students get different orders and the key never reaches them', () => {
    const questions = makeQuestions(20);
    const one = studentPaper(questions, 1, 5);
    const two = studentPaper(questions, 2, 5);
    assert.notDeepEqual(one.questions.map((q) => q.text), two.questions.map((q) => q.text));
    assert.deepEqual(one, studentPaper(questions, 1, 5));
    assert.ok(!JSON.stringify(one).includes('correct'));
    const positions = new Set(Array.from({ length: 40 }, (_, user) => studentPaper(questions, user, 5).questions[0].options.findIndex((o) => o.startsWith('togri'))));
    assert.ok(positions.size > 1);
  });

  test('grading follows each student’s own positions', () => {
    const questions = makeQuestions(10);
    const paper = studentPaper(questions, 7, 3);
    const answers = paper.questions.map((q) => q.options.findIndex((o) => o.startsWith('togri')));
    assert.equal(gradeAnswers(questions, 7, 3, answers).correct, 10);
    assert.equal(gradeAnswers(questions, 7, 3, [0]), null);
  });

  test('a docx with tests is read without calling AI', async () => {
    let aiCalls = 0;
    const saved = llm.extractQuestions;
    llm.extractQuestions = async () => { aiCalls++; return []; };
    const up = await uploadSource(teacher, 'test.docx', makeDocx(['1. Poytaxt qaysi?', 'A) Samarqand', '*B) Toshkent', '2. Ikki karra ikki?', 'A) uch', '+B) to‘rt']));
    assert.equal(up.statusCode, 200, JSON.stringify(up.body));
    const res = await teacher.post('quiz', { action: 'extract', file_id: up.body.id, mode: 'parsed' });
    llm.extractQuestions = saved;
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.source, 'file');
    assert.deepEqual(res.body.questions.map((q) => q.correct), [1, 1]);
    assert.equal(aiCalls, 0);
  });

  test('unmarked tests get their answers from AI and are flagged for review', async () => {
    const saved = llm.solveQuestions;
    let positions;
    llm.solveQuestions = async (_, missing) => { positions = missing; return new Map([[0, 1]]); };
    const up = await uploadSource(teacher, 'plain.docx', makeDocx(['1. Poytaxt qaysi?', 'A) Samarqand', 'B) Toshkent', '2. Ikki karra ikki?', 'A) uch', 'B) to‘rt', 'Yana ma’lumot bor']));
    const res = await teacher.post('quiz', { action: 'extract', file_id: up.body.id, mode: 'parsed' });
    llm.solveQuestions = saved;
    assert.deepEqual(positions, [0, 1]);
    assert.equal(res.body.answered_by_ai, 1);
    assert.equal(res.body.questions[0].correct, 1);
    assert.equal(res.body.questions[0].ai_marked, true);
    assert.equal(res.body.questions[1].correct, null);
  });

  test('if AI is unavailable, unmarked tests still come back for manual marking', async () => {
    const saved = llm.solveQuestions;
    llm.solveQuestions = async () => { throw new llm.AssistantError(429, 'busy'); };
    const up = await uploadSource(teacher, 'plain2.docx', makeDocx(['1. Poytaxt qaysi?', 'A) Samarqand', 'B) Toshkent']));
    const res = await teacher.post('quiz', { action: 'extract', file_id: up.body.id, mode: 'parsed' });
    llm.solveQuestions = saved;
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.answered_by_ai, 0);
    assert.equal(res.body.questions[0].correct, null);
  });

  test('an information file produces the requested number of AI questions', async () => {
    let requested;
    const saved = llm.generateQuestions;
    llm.generateQuestions = async (_, count) => { requested = count; return [{ text: 'S?', options: ['a', 'b', 'c', 'd'], correct_index: 2 }]; };
    const up = await uploadSource(teacher, 'info.docx', makeDocx(['Didaktika ta’lim jarayonining qonuniyatlarini o‘rganadigan fan sohasidir.']));
    const res = await teacher.post('quiz', { action: 'extract', file_id: up.body.id, mode: 'generate', count: 7 });
    llm.generateQuestions = saved;
    assert.equal(requested, 7);
    assert.equal(res.body.source, 'ai');
    assert.equal(res.body.questions[0].correct, 2);
    assert.equal((await teacher.post('quiz', { action: 'extract', file_id: up.body.id, mode: 'generate', count: 31 })).statusCode, 400);
  });

  test('only staff may read source files for quizzes', async () => {
    assert.equal((await uploadSource(student, 'a.docx', makeDocx(['x']))).statusCode, 403);
    const up = await uploadSource(teacher, 'b.docx', makeDocx(['1. Bir savol matni bu yerda?', 'A) x', 'B) y']));
    assert.equal((await student.post('quiz', { action: 'extract', file_id: up.body.id, mode: 'parsed' })).statusCode, 403);
    assert.equal((await admin.post('quiz', { action: 'extract', file_id: up.body.id, mode: 'parsed' })).statusCode, 404);
  });

  test('a question without a correct answer cannot be saved', async () => {
    const id = await addModule(teacher);
    const res = await teacher.post('content', { module_id: id, step_type: 'diag', content: { value: '', questions: [{ text: 'S', options: ['a', 'b'], correct: null }] } });
    assert.equal(res.statusCode, 400);
  });

  test('a student takes the shuffled test and is scored on the server', async () => {
    const id = await addModule(teacher);
    await addContent(teacher, id, 'diag', { value: '', questions: makeQuestions(10) });
    const content = await student.get('content', { module_id: String(id) });
    const row = content.body.find((r) => r.step_type === 'diag');
    assert.equal(row.content.questions, undefined);
    assert.equal(row.content.questions_count, 10);

    const paper = (await student.get('quiz', { module_id: String(id) })).body;
    const answers = paper.questions.map((q, i) => (i < 6 ? q.options.findIndex((o) => o.startsWith('togri')) : q.options.findIndex((o) => o.startsWith('xato'))));
    assert.equal((await student.post('progress', { module_id: id, step_type: 'diag', answers, version: 'stale' })).statusCode, 409);
    assert.equal((await student.post('progress', { module_id: id, step_type: 'diag', answers: [0], version: paper.version })).statusCode, 400);
    const done = await student.post('progress', { module_id: id, step_type: 'diag', answers, version: paper.version });
    assert.equal(done.statusCode, 200, JSON.stringify(done.body));
    assert.deepEqual(done.body.step_responses.diag_result, { correct: 6, total: 10, score: 9 });
    assert.equal(done.body.total_score, 9);
    assert.equal(done.body.step_responses.diag_detail, undefined);
    const own = await student.get('progress', { module_id: String(id) });
    assert.equal(own.body[0].step_responses.diag_detail, undefined);
    assert.equal(own.body[0].step_responses.diag_result.correct, 6);

    const seen = await teacher.get('progress', { module_id: String(id) });
    const detail = seen.body[0].step_responses.diag_detail;
    assert.equal(detail.filter((item) => !item.correct).length, 4);
    const miss = detail.find((item) => !item.correct);
    assert.match(miss.chosen, /^xato/);
    assert.match(miss.right, /^togri/);
  });
});
