const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
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

  const loginFrom = (ip, login, password) => harness.client().call('auth', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: { action: 'login', login: login.includes('@') ? login : `${login}@gmail.com`, password }
  });

  test('a lock applies only to the address that guessed wrong', async () => {
    const login = unique('targeted');
    await harness.client().register(login);
    for (let i = 0; i < 5; i++) assert.equal((await loginFrom('198.51.100.20', login, 'wrong-password')).statusCode, 401);
    assert.equal((await loginFrom('198.51.100.20', login, 'a-valid-password')).statusCode, 429);
    // The owner, on another network, still gets in.
    assert.equal((await loginFrom('198.51.100.21', login, 'a-valid-password')).statusCode, 200);
  });

  test('one address guessing many accounts is stopped', async () => {
    const ip = '198.51.100.30';
    for (let i = 0; i < 20; i++) assert.equal((await loginFrom(ip, `${unique('nobody')}@gmail.com`, 'wrong-password')).statusCode, 401);
    const login = unique('innocent');
    await harness.client().register(login);
    assert.equal((await loginFrom(ip, login, 'a-valid-password')).statusCode, 429);
    assert.equal((await loginFrom('198.51.100.31', login, 'a-valid-password')).statusCode, 200);
  });

  test('a session in use is extended, an idle one is not', async () => {
    const login = unique('active');
    const person = harness.client();
    await person.register(login);
    const [account] = await harness.sql`SELECT id FROM np_users WHERE login=${`${login}@gmail.com`}`;
    await harness.sql`UPDATE np_sessions SET expires_at = NOW() + INTERVAL '30 minutes' WHERE user_id=${account.id}`;
    const res = await person.get('auth');
    assert.ok(res.body.user);
    assert.match(res.headers['set-cookie'], /Max-Age=43200/);
    const [session] = await harness.sql`SELECT expires_at > NOW() + INTERVAL '11 hours' AS renewed FROM np_sessions WHERE user_id=${account.id}`;
    assert.equal(session.renewed, true);
    // Within the first hour nothing is written again.
    assert.equal((await person.get('auth')).headers['set-cookie'], undefined);
  });

  test('old rate-limit, code and session rows are swept away', async () => {
    const { sweepExpiredRows } = require('../api/_cleanup');
    await harness.sql`INSERT INTO np_rate_limits(bucket, window_start, hits) VALUES('old-bucket', NOW() - INTERVAL '2 days', 3)`;
    await harness.sql`INSERT INTO np_rate_limits(bucket, window_start, hits) VALUES('fresh-bucket', NOW(), 1)`;
    await sweepExpiredRows({ force: true });
    const buckets = (await harness.sql`SELECT bucket FROM np_rate_limits WHERE bucket IN ('old-bucket', 'fresh-bucket')`).map((row) => row.bucket);
    assert.deepEqual(buckets, ['fresh-bucket']);
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

describe('own profile', () => {
  const patch = (by, body) => by.call('profile', { method: 'PATCH', body });

  test('guests are refused and each user sees only their own account', async () => {
    assert.equal((await harness.client().get('profile')).statusCode, 401);
    const mine = await student.get('profile');
    assert.equal(mine.body.login, 'student_one@gmail.com');
    assert.equal(mine.body.password, undefined);
  });

  test('a user can rename only themselves, and role cannot change this way', async () => {
    const name = unique('renamer');
    const person = harness.client();
    await person.register(name);
    assert.equal((await patch(person, { name: 'x' })).statusCode, 400);
    const res = await patch(person, { name: 'New Name', role: 'admin', id: 1 });
    assert.equal(res.body.name, 'New Name');
    assert.equal(res.body.role, 'student');
    const [admin_] = await harness.sql`SELECT name FROM np_users WHERE id=1`;
    assert.notEqual(admin_.name, 'New Name');
  });

  test('changing the password needs the current one and signs out other devices', async () => {
    const name = unique('changer');
    const phone = harness.client();
    await phone.register(name);
    const laptop = harness.client();
    assert.equal((await laptop.login(name, 'a-valid-password')).statusCode, 200);

    assert.equal((await phone.post('profile', { current_password: 'wrong-password', new_password: 'another-password' })).statusCode, 400);
    assert.equal((await phone.post('profile', { current_password: 'a-valid-password', new_password: 'short' })).statusCode, 400);
    assert.equal((await phone.post('profile', { current_password: 'a-valid-password', new_password: 'another-password' })).statusCode, 200);

    assert.equal((await laptop.get('auth')).body.user, null);
    assert.ok((await phone.get('auth')).body.user);
    assert.equal((await harness.client().login(name, 'a-valid-password')).statusCode, 401);
    assert.equal((await harness.client().login(name, 'another-password')).statusCode, 200);
  });

  test('guessing the current password is limited', async () => {
    const name = unique('guesser');
    const person = harness.client();
    await person.register(name);
    const attempt = () => person.post('profile', { current_password: 'wrong-password', new_password: 'another-password' });
    for (let i = 0; i < 5; i++) assert.equal((await attempt()).statusCode, 400);
    assert.equal((await attempt()).statusCode, 429);
  });
});

describe('teacher approval', () => {
  test('a new teacher waits for the administrator and cannot sign in until approved', async () => {
    const name = unique('newteacher');
    // Notices go to administrators whose login is a mailbox.
    const [notified] = await harness.sql`
      INSERT INTO np_users(name, login, password, role) VALUES('Mail Admin', 'mailadmin@gmail.com', 'x', 'admin') RETURNING id`;
    const applicant = harness.client();
    const res = await applicant.register(name, 'teacher', { approve: false });
    await harness.sql`DELETE FROM np_users WHERE id=${notified.id}`;
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.pending, true);
    assert.equal((await applicant.get('auth')).body.user, null);
    assert.ok(harness.outbox.some((item) => item.to === 'mailadmin@gmail.com' && item.teacherRequest === `${name}@gmail.com`));

    const early = await harness.client().login(name, 'a-valid-password');
    assert.equal(early.statusCode, 403);
    assert.equal(early.body.pending, true);

    const queue = await admin.get('users', { status: 'pending' });
    const row = queue.body.items.find((item) => item.login === `${name}@gmail.com`);
    assert.ok(row);
    assert.ok(queue.body.counts.pending >= 1);
    const teachers = await admin.get('users', { role: 'teacher', q: name });
    assert.equal(teachers.body.items.length, 0);

    assert.equal((await teacher.post('users', { action: 'approve', id: row.id })).statusCode, 403);
    const approved = await admin.post('users', { action: 'approve', id: row.id });
    assert.equal(approved.statusCode, 200);
    assert.equal(harness.outbox.at(-1).approved, true);
    assert.equal((await harness.client().login(name, 'a-valid-password')).statusCode, 200);
    assert.equal((await admin.post('users', { action: 'approve', id: row.id })).statusCode, 404);
  });

  test('a rejected request is removed so the mailbox can apply again', async () => {
    const name = unique('rejected');
    await harness.client().register(name, 'teacher', { approve: false });
    const [row] = await harness.sql`SELECT id FROM np_users WHERE login=${`${name}@gmail.com`}`;
    assert.equal((await admin.post('users', { action: 'reject', id: row.id })).statusCode, 200);
    assert.equal(harness.outbox.at(-1).approved, false);
    assert.equal((await harness.sql`SELECT 1 FROM np_users WHERE id=${row.id}`).length, 0);
    assert.equal((await harness.client().login(name, 'a-valid-password')).statusCode, 401);
  });
});

describe('module ownership', () => {
  let rival, rivalModule;
  before(async () => {
    rival = harness.client();
    await rival.register(unique('rival_teacher'), 'teacher');
    rivalModule = await addModule(rival);
  });

  test('a teacher cannot change another teacher’s module', async () => {
    const edit = await teacher.post('modules', { id: rivalModule, order_num: 999001, title: 'Hijacked' });
    assert.equal(edit.statusCode, 403);
    assert.equal((await teacher.call('modules', { method: 'DELETE', query: { id: rivalModule } })).statusCode, 403);
    assert.equal((await teacher.post('content', { module_id: rivalModule, step_type: 'task', content: { value: 'Mine now' } })).statusCode, 403);
    assert.equal((await teacher.call('content', { method: 'DELETE', query: { module_id: rivalModule, step_type: 'task' } })).statusCode, 403);
    const upload = await teacher.upload({ moduleId: rivalModule, stepType: 'pres', purpose: 'content', filename: 'x.pptx', bytes: PPTX });
    assert.equal(upload.statusCode, 403);
    const [module] = await harness.sql`SELECT title FROM np_modules WHERE id=${rivalModule}`;
    assert.equal(module.title, 'Module');
  });

  test('the administrator manages every module', async () => {
    assert.equal((await admin.post('modules', { id: rivalModule, order_num: 999002, title: 'Renamed by admin' })).statusCode, 200);
    assert.equal((await admin.post('content', { module_id: rivalModule, step_type: 'task', content: { value: 'Admin task' } })).statusCode, 200);
  });

  test('a teacher sees and restores only their own deleted modules', async () => {
    const mine = await addModule(teacher);
    assert.equal((await teacher.call('modules', { method: 'DELETE', query: { id: mine } })).statusCode, 200);
    assert.equal((await rival.call('modules', { method: 'DELETE', query: { id: rivalModule } })).statusCode, 200);

    const listed = (await teacher.get('modules', { deleted: '1' })).body.map((row) => row.id);
    assert.ok(listed.includes(mine));
    assert.ok(!listed.includes(rivalModule));
    assert.equal((await teacher.post('modules', { action: 'restore', id: rivalModule })).statusCode, 403);
    assert.equal((await teacher.post('modules', { action: 'restore', id: mine })).statusCode, 200);
    assert.equal((await admin.post('modules', { action: 'restore', id: rivalModule })).statusCode, 200);
  });

  test('only the module’s teacher or the administrator reviews its work', async () => {
    const pupil = harness.client();
    await pupil.register(unique('pupil'));
    const id = await buildFullModule(rival);
    await finishUntilTask(pupil, id);
    await pupil.post('progress', { module_id: id, step_type: 'task', response: 'My answer' });
    const [row] = await harness.sql`SELECT id FROM np_progress WHERE module_id=${id}`;
    const review = { action: 'review', progress_id: row.id, step: 'task', feedback: 'Good' };
    assert.equal((await teacher.post('progress', review)).statusCode, 403);
    assert.equal((await rival.post('progress', review)).statusCode, 200);
    assert.equal((await admin.post('progress', review)).statusCode, 200);
  });
});

describe('error log', () => {
  test('browsers report errors and only the administrator reads or clears them', async () => {
    const visitor = harness.client();
    const sent = await visitor.call('errors', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'Test browser' },
      body: { message: 'TypeError: x is undefined', detail: 'at app.tsx:10', path: '/#/modules' }
    });
    assert.equal(sent.statusCode, 202);
    assert.equal((await visitor.call('errors', { method: 'POST', body: { message: '  ' } })).statusCode, 400);

    assert.equal((await teacher.get('errors')).statusCode, 403);
    const log = await admin.get('errors');
    assert.equal(log.statusCode, 200);
    const row = log.body.items.find((item) => item.message === 'TypeError: x is undefined');
    assert.equal(row.source, 'client');
    assert.equal(row.path, '/#/modules');
    assert.ok(log.body.last_day >= 1);
  });

  test('server failures are written to the log', async () => {
    const { reportServerError } = require('../api/_errors');
    const original = console.error;
    console.error = () => {};
    await reportServerError(new Error('database went away'), { method: 'POST', url: '/api/progress?x=1', headers: {} });
    console.error = original;
    const log = await admin.get('errors');
    const row = log.body.items.find((item) => item.message === 'database went away');
    assert.equal(row.source, 'server');
    assert.equal(row.path, 'POST /api/progress');
    assert.equal((await admin.call('errors', { method: 'DELETE' })).statusCode, 200);
    assert.equal((await admin.get('errors')).body.total, 0);
  });

  test('error reports from one address are limited', async () => {
    const visitor = harness.client();
    const send = () => visitor.call('errors', { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.7' }, body: { message: 'boom' } });
    for (let i = 0; i < 30; i++) assert.equal((await send()).statusCode, 202);
    assert.equal((await send()).statusCode, 429);
  });
});

describe('migrations', () => {
  test('each migration is recorded once and a second run applies nothing', async () => {
    const versions = (await harness.sql`SELECT version FROM np_schema_migrations ORDER BY version`).map((row) => row.version);
    assert.deepEqual(versions, require('../api/_migrations').map((migration) => migration.version));
    const { migrate } = require('../api/_migrate');
    assert.deepEqual(await migrate(harness.sql), []);
  });
});

describe('Supabase Storage', () => {
  const { createFakeStorage } = require('./helpers/fake-storage');
  let fake, uninstall;
  before(() => {
    fake = createFakeStorage();
    uninstall = fake.install();
  });
  after(() => uninstall());

  async function directUpload(by, { moduleId: id, stepType, purpose, filename, bytes }) {
    const init = await by.post('files', { action: 'init', module_id: id, step_type: stepType, purpose, filename, size: bytes.length });
    if (init.statusCode !== 201) return init;
    assert.equal(init.body.mode, 'direct');
    const put = await fetch(init.body.upload_url, { method: 'PUT', body: bytes });
    assert.equal(put.status, 200);
    return by.post('files', { action: 'complete', id: init.body.id });
  }

  test('setup creates a private bucket once', async () => {
    const storage = require('../api/_storage');
    assert.equal(await storage.ensureBucket(), 'created');
    assert.equal(await storage.ensureBucket(), 'exists');
  });

  test('files go straight to Storage and come back through a signed download link', async () => {
    const id = await addModule(teacher);
    const done = await directUpload(teacher, { moduleId: id, stepType: 'pres', purpose: 'content', filename: 'dars.pptx', bytes: PPTX });
    assert.equal(done.statusCode, 200, JSON.stringify(done.body));
    const [row] = await harness.sql`SELECT storage_path, status FROM np_files WHERE id=${done.body.id}::uuid`;
    assert.equal(row.status, 'ready');
    assert.ok(fake.objects.has(row.storage_path));
    assert.equal((await harness.sql`SELECT 1 FROM np_file_chunks WHERE file_id=${done.body.id}::uuid`).length, 0);

    const meta = await student.get('files', { id: done.body.id });
    assert.equal(meta.statusCode, 200);
    assert.match(meta.body.url, /^https:\/\/fake-project\.supabase\.co\/storage\/v1\/object\/sign\/files\/content\/.+\?token=dl&download=dars\.pptx$/);
    assert.equal((await student.get('files', { id: done.body.id, chunk: '0' })).statusCode, 400);

    await addContent(teacher, id, 'pres', { value: '', file_id: done.body.id });
    const second = await directUpload(teacher, { moduleId: id, stepType: 'pres', purpose: 'content', filename: 'yangi.pptx', bytes: PPTX });
    await addContent(teacher, id, 'pres', { value: '', file_id: second.body.id });
    assert.ok(!fake.objects.has(row.storage_path), 'the replaced file is removed from Storage');
  });

  test('an upload that does not match its format or size is rejected and removed', async () => {
    const id = await addModule(teacher);
    const init = await teacher.post('files', { action: 'init', module_id: id, step_type: 'pres', purpose: 'content', filename: 'fake.pptx', size: PDF.length });
    await fetch(init.body.upload_url, { method: 'PUT', body: PDF });
    const done = await teacher.post('files', { action: 'complete', id: init.body.id });
    assert.equal(done.statusCode, 415);
    assert.equal((await harness.sql`SELECT 1 FROM np_files WHERE id=${init.body.id}::uuid`).length, 0);
    assert.equal([...fake.objects.keys()].some((key) => key.includes(init.body.id)), false);

    const lying = await teacher.post('files', { action: 'init', module_id: id, step_type: 'pres', purpose: 'content', filename: 'big.pptx', size: PPTX.length + 50 });
    await fetch(lying.body.upload_url, { method: 'PUT', body: PPTX });
    assert.equal((await teacher.post('files', { action: 'complete', id: lying.body.id })).statusCode, 415);

    const missing = await teacher.post('files', { action: 'init', module_id: id, step_type: 'pres', purpose: 'content', filename: 'none.pptx', size: PPTX.length });
    assert.equal((await teacher.post('files', { action: 'complete', id: missing.body.id })).statusCode, 409);
    assert.equal((await teacher.post('files', { action: 'chunk', id: missing.body.id, index: 0, data: 'AAAA' })).statusCode, 409);
  });

  test('the old chunks move to Storage and stay downloadable', async () => {
    uninstall();
    const id = await addModule(teacher);
    const legacy = await teacher.upload({ moduleId: id, stepType: 'doc', purpose: 'content', filename: 'eski.pdf', bytes: PDF });
    assert.equal(legacy.statusCode, 200);
    uninstall = fake.install();

    const { moveFilesToStorage } = require('../scripts/move-files-to-storage');
    const moved = await moveFilesToStorage(harness.sql, { log: () => {} });
    assert.ok(moved >= 1);
    const [row] = await harness.sql`SELECT storage_path FROM np_files WHERE id=${legacy.body.id}::uuid`;
    assert.deepEqual(fake.objects.get(row.storage_path), PDF);
    assert.equal((await harness.sql`SELECT 1 FROM np_file_chunks WHERE file_id=${legacy.body.id}::uuid`).length, 0);
    assert.match((await student.get('files', { id: legacy.body.id })).body.url, /download=eski\.pdf$/);
    uninstall();
  });
});

describe('mail service', () => {
  test('with a Resend key the code goes through the mail service from your own domain', async () => {
    delete require.cache[require.resolve('../api/_mail')];
    const mail = require('../api/_mail');
    const saved = { fetch: global.fetch, key: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM };
    const sent = [];
    global.fetch = async (url, init) => {
      sent.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
      return new Response('{"id":"1"}', { status: 200 });
    };
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.MAIL_FROM = 'noreply@talim.example';
    const original = console.log;
    console.log = () => {};
    try {
      await mail.sendCode('user@gmail.com', '123456', 'register');
      global.fetch = async () => new Response('{"message":"domain not verified"}', { status: 403 });
      await assert.rejects(mail.sendCode('user@gmail.com', '123456', 'register'), /refused/);
    } finally {
      console.log = original;
      global.fetch = saved.fetch;
      if (saved.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.key;
      if (saved.from === undefined) delete process.env.MAIL_FROM; else process.env.MAIL_FROM = saved.from;
    }
    assert.equal(sent[0].url, 'https://api.resend.com/emails');
    assert.equal(sent[0].auth, 'Bearer re_test_key');
    assert.deepEqual(sent[0].body.to, ['user@gmail.com']);
    assert.equal(sent[0].body.from, "Ta'lim Nazariyasi <noreply@talim.example>");
    assert.match(sent[0].body.text, /123456/);
  });
});

describe('contact form', () => {
  const send = (body, ip = '192.0.2.10') => harness.client().call('contact', { method: 'POST', body, headers: { 'x-forwarded-for': ip } });

  test('a question goes to the platform inbox with the visitor as the reply address', async () => {
    const res = await send({ name: 'Dilnoza Karimova', email: 'dilnoza@example.com', message: 'Modullar qachon yangilanadi?' });
    assert.equal(res.statusCode, 202);
    const mail = harness.outbox.at(-1);
    assert.equal(mail.to, 'uzforedu@gmail.com');
    assert.deepEqual(mail.contact, { name: 'Dilnoza Karimova', email: 'dilnoza@example.com', message: 'Modullar qachon yangilanadi?' });
  });

  test('incomplete messages are refused and a filled hidden field sends nothing', async () => {
    const before = harness.outbox.length;
    assert.equal((await send({ name: 'A', email: 'a@example.com', message: 'Yetarlicha uzun savol' })).statusCode, 400);
    assert.equal((await send({ name: 'Ali', email: 'not-an-email', message: 'Yetarlicha uzun savol' })).statusCode, 400);
    assert.equal((await send({ name: 'Ali', email: 'ali@example.com', message: 'Qisqa' })).statusCode, 400);
    assert.equal((await send({ name: 'Bot', email: 'bot@example.com', message: 'Arzon reklama xizmati', website: 'spam.example' })).statusCode, 202);
    assert.equal(harness.outbox.length, before);
  });

  test('one address can send only a few messages an hour', async () => {
    const message = { name: 'Takror', email: 'takror@example.com', message: 'Bir xil savol yana bir bor' };
    for (let i = 0; i < 5; i++) assert.equal((await send(message, '198.51.100.20')).statusCode, 202);
    assert.equal((await send(message, '198.51.100.20')).statusCode, 429);
  });

  test('the reply-to line carries only the name and the email', async () => {
    delete require.cache[require.resolve('../api/_mail')];
    const real = require('../api/_mail');
    const saved = { fetch: global.fetch, key: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM };
    let sentBody;
    global.fetch = async (_url, init) => { sentBody = JSON.parse(init.body); return new Response('{}', { status: 200 }); };
    process.env.RESEND_API_KEY = 're_test';
    process.env.MAIL_FROM = 'noreply@talim.example';
    const log = console.log;
    console.log = () => {};
    try {
      await real.sendContactMessage('uzforedu@gmail.com', { name: 'Ali <script>\r\nBcc: x@y.z', email: 'ali@example.com', message: 'Savol matni' });
    } finally {
      console.log = log;
      global.fetch = saved.fetch;
      if (saved.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.key;
      if (saved.from === undefined) delete process.env.MAIL_FROM; else process.env.MAIL_FROM = saved.from;
    }
    assert.deepEqual(sentBody.to, ['uzforedu@gmail.com']);
    assert.equal(sentBody.reply_to, 'Ali scriptBcc: x@y.z <ali@example.com>');
    assert.match(sentBody.text, /Savol matni[\s\S]*ali@example\.com/);
  });
});

describe('deleting accounts', () => {
  test('the administrator deletes a student with their answers and files, and the mailbox can register again', async () => {
    const name = unique('leaver');
    const pupil = harness.client();
    await pupil.register(name);
    const id = await buildFullModule(teacher);
    await finishUntilTask(pupil, id);
    const upload = await pupil.upload({ moduleId: id, stepType: 'task', purpose: 'submission', filename: 'javob.pdf', bytes: PDF });
    await pupil.post('progress', { module_id: id, step_type: 'task', response: 'Javob', file_id: upload.body.id });
    const [row] = await harness.sql`SELECT id FROM np_users WHERE login=${`${name}@gmail.com`}`;

    assert.equal((await teacher.post('users', { action: 'delete', id: row.id })).statusCode, 403);
    const res = await admin.post('users', { action: 'delete', id: row.id });
    assert.equal(res.statusCode, 200);
    assert.equal(harness.outbox.at(-1).accountDeleted, true);
    assert.equal((await harness.sql`SELECT 1 FROM np_users WHERE id=${row.id}`).length, 0);
    assert.equal((await harness.sql`SELECT 1 FROM np_progress WHERE user_id=${row.id}`).length, 0);
    assert.equal((await harness.sql`SELECT 1 FROM np_files WHERE id=${upload.body.id}::uuid`).length, 0);
    assert.equal((await pupil.get('auth')).body.user, null);
    assert.equal((await harness.client().login(name, 'a-valid-password')).statusCode, 401);
    assert.equal((await harness.client().register(name)).statusCode, 201);
    assert.equal((await admin.post('users', { action: 'delete', id: row.id })).statusCode, 404);
  });

  test('a deleted teacher’s modules stay for students and pass to the administrator', async () => {
    const name = unique('leaving_teacher');
    const author = harness.client();
    await author.register(name, 'teacher');
    const id = await buildFullModule(author);
    const [row] = await harness.sql`SELECT id FROM np_users WHERE login=${`${name}@gmail.com`}`;

    const res = await admin.post('users', { action: 'delete', id: row.id });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.modules_kept, 1);
    const [module] = await harness.sql`SELECT created_by, deleted_at FROM np_modules WHERE id=${id}`;
    assert.equal(module.created_by, null);
    assert.equal(module.deleted_at, null);
    assert.ok((await student.get('content', { module_id: id })).body.length >= 6);
    assert.equal((await teacher.post('modules', { id, order_num: 999500, title: 'Mine now' })).statusCode, 403);
    assert.equal((await admin.post('modules', { id, order_num: 999501, title: 'Admin keeps it' })).statusCode, 200);
  });

  test('administrators and the administrator’s own account cannot be deleted here', async () => {
    const [self] = await harness.sql`SELECT id FROM np_users WHERE login=${TEST_ADMIN.login}`;
    assert.equal((await admin.post('users', { action: 'delete', id: self.id })).statusCode, 400);
    const [other] = await harness.sql`
      INSERT INTO np_users(name, login, password, role) VALUES('Second Admin', 'second_admin', 'x', 'admin') RETURNING id`;
    assert.equal((await admin.post('users', { action: 'delete', id: other.id })).statusCode, 404);
    await harness.sql`DELETE FROM np_users WHERE id=${other.id}`;
  });
});

describe('one router for every endpoint', () => {
  test('the router hands /api/<name> to its handler and refuses unknown names', async () => {
    const { createResponse } = require('./helpers/harness');
    const call = async (url, query = {}) => {
      const res = createResponse();
      await harness.handlers.router({ method: 'GET', url, query, headers: {} }, res);
      return res;
    };
    const viaRewrite = await call('/api/router?__route=modules', { __route: 'modules' });
    assert.equal(viaRewrite.statusCode, 200);
    assert.ok(Array.isArray(viaRewrite.body));
    assert.equal((await call('/api/modules')).statusCode, 200);
    assert.equal((await call('/api/nothing-here')).statusCode, 404);
    assert.equal((await call('/api/router', { __route: 'constructor' })).statusCode, 404);
  });
});

describe('groups', () => {
  let groupId, code;
  test('a teacher creates a group and a student joins it with the code', async () => {
    const created = await teacher.post('groups', { action: 'create', name: '  301-guruh  ' });
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.name, '301-guruh');
    assert.match(created.body.code, /^[A-HJ-NP-Z2-9]{6}$/);
    ({ id: groupId, code } = created.body);

    assert.equal((await student.post('groups', { action: 'join', code: 'ZZZZZZ' })).statusCode, 404);
    assert.equal((await student.post('groups', { action: 'join', code: code.toLowerCase() })).statusCode, 201);
    assert.equal((await student.post('groups', { action: 'join', code })).statusCode, 409);
    assert.equal((await student.get('groups')).body[0].name, '301-guruh');
    assert.equal((await student.post('groups', { action: 'create', name: 'Mine' })).statusCode, 403);

    const detail = await teacher.get('groups', { id: String(groupId) });
    assert.deepEqual(detail.body.members.map((m) => m.login), ['student_one@gmail.com']);
    assert.equal((await teacher.get('groups')).body.find((g) => g.id === groupId).member_count, 1);
  });

  test('results can be filtered by group, and only the owner or the administrator manages it', async () => {
    const all = await teacher.get('progress', { module_id: String(moduleId) });
    const inGroup = await teacher.get('progress', { module_id: String(moduleId), group_id: String(groupId) });
    assert.ok(inGroup.body.every((row) => row.student_login === 'student_one@gmail.com'));
    assert.ok(all.body.length >= inGroup.body.length);

    const outsider = harness.client();
    await outsider.register(unique('outsider_teacher'), 'teacher');
    assert.equal((await outsider.get('groups', { id: String(groupId) })).statusCode, 404);
    assert.equal((await outsider.post('groups', { action: 'new_code', id: groupId })).statusCode, 404);
    assert.ok((await admin.get('groups')).body.some((g) => g.id === groupId));

    const renewed = await teacher.post('groups', { action: 'new_code', id: groupId });
    assert.notEqual(renewed.body.code, code);
    const [{ id: studentId }] = await harness.sql`SELECT id FROM np_users WHERE login='student_one@gmail.com'`;
    assert.equal((await teacher.post('groups', { action: 'remove_member', id: groupId, user_id: studentId })).statusCode, 200);
    assert.equal((await teacher.call('groups', { method: 'DELETE', query: { id: String(groupId) } })).statusCode, 200);
    assert.equal((await student.get('groups')).body.length, 0);
  });
});

describe('quiz retakes, answers and certificates', () => {
  const QUESTIONS = [
    { text: 'Didaktika nima?', options: ['Kimyo', 'Ta’lim nazariyasi', 'Fizika'], correct: 1, explanation: 'Didaktika ta’lim nazariyasidir.' },
    { text: '2 + 2?', options: ['3', '4'], correct: 0 }
  ];
  let quizModule;

  async function answerAll(by, id, attemptRetake = false) {
    const paper = (await by.get('quiz', { module_id: String(id) })).body;
    const answers = paper.questions.map(() => 0);
    return by.post('progress', { module_id: id, step_type: 'diag', answers, version: paper.version, ...(attemptRetake ? { retake: true } : {}) });
  }

  test('explanations are stored and a retake needs the teacher’s permission', async () => {
    quizModule = await buildFullModule(teacher);
    await addContent(teacher, quizModule, 'diag', { value: '', questions: QUESTIONS, allow_retake: false, show_answers: false });
    const pupil = harness.client();
    await pupil.register(unique('retaker'));
    const first = await answerAll(pupil, quizModule);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.step_responses.diag_detail, undefined);
    assert.equal((await answerAll(pupil, quizModule, true)).statusCode, 403);

    await addContent(teacher, quizModule, 'diag', { value: '', questions: QUESTIONS, allow_retake: true, show_answers: true });
    const before = (await pupil.get('progress', { module_id: String(quizModule) })).body[0];
    assert.equal(before.step_responses.diag_detail.find((d) => d.explanation)?.explanation, 'Didaktika ta’lim nazariyasidir.');

    const retake = await answerAll(pupil, quizModule, true);
    assert.equal(retake.statusCode, 200);
    assert.equal(retake.body.step_responses.diag_attempts, 2);
    assert.ok(retake.body.total_score >= before.total_score, 'the best result counts');
    assert.ok(retake.body.step_responses.diag_last);
  });

  const scoreWork = async (pupilLogin, task, refl) => {
    const [row] = await harness.sql`SELECT p.id FROM np_progress p JOIN np_users u ON u.id = p.user_id WHERE u.login=${`${pupilLogin}@gmail.com`} AND p.module_id=${moduleId}`;
    await teacher.post('progress', { action: 'review', progress_id: row.id, step: 'task', score: task, feedback: '' });
    return teacher.post('progress', { action: 'review', progress_id: row.id, step: 'refl', score: refl, feedback: 'Yaxshi fikrlar' });
  };
  const finishModule = async (pupil) => {
    await finishUntilTask(pupil, moduleId);
    await pupil.post('progress', { module_id: moduleId, step_type: 'task', response: 'Rejam' });
    return pupil.post('progress', { module_id: moduleId, step_type: 'refl', response: 'O‘rgandim' });
  };

  test('a finished module waits for the teacher’s scores, then issues a graded certificate anyone can check', async () => {
    const pupil = harness.client();
    const name = unique('graduate');
    await pupil.register(name);
    const last = await finishModule(pupil);
    assert.equal(last.statusCode, 200);
    assert.equal(last.body.certificate, undefined);
    assert.deepEqual(last.body.result.waiting, ['task', 'refl']);
    assert.equal(last.body.result.percent, null);
    assert.deepEqual(await pupil.get('certificates').then((res) => res.body), []);

    // A wrong test answer (0%), the three materials (30%), the task at 90 and the reflection at 80:
    // 0·30 + 30 + 0.9·25 + 0.8·15 = 64.5 → 65%, a 3 (qoniqarli).
    const graded = await scoreWork(name, 90, 80);
    assert.equal(graded.statusCode, 200);
    assert.equal(graded.body.result.percent, 65);
    assert.equal(graded.body.result.grade, 3);
    assert.match(graded.body.certificate.code, /^[A-HJ-NP-Z2-9]{10}$/);
    assert.equal(graded.body.certificate.student_name, `Name ${name}`);
    assert.equal(graded.body.certificate.percent, 65);

    const mine = await pupil.get('certificates');
    assert.equal(mine.body.length, 1);
    assert.equal(mine.body[0].code, graded.body.certificate.code);
    const check = await harness.client().get('certificates', { code: graded.body.certificate.code.toLowerCase() });
    assert.equal(check.body.valid, true);
    assert.equal(check.body.module_title, 'Module');
    assert.equal(check.body.grade, 3);
    assert.equal(check.body.percent, 65);

    // A changed score changes the grade on the same certificate.
    const raised = await scoreWork(name, 100, 100);
    assert.equal(raised.body.certificate.code, graded.body.certificate.code);
    assert.equal(raised.body.certificate.percent, 70);
    assert.deepEqual((await harness.client().get('certificates', { code: 'NOTREAL234' })).body, { valid: false });
    assert.equal((await teacher.get('certificates')).statusCode, 403);
  });

  test('a result under 55% earns no certificate until it improves', async () => {
    const pupil = harness.client();
    const name = unique('struggling');
    await pupil.register(name);
    await finishModule(pupil);
    const low = await scoreWork(name, 20, 10);
    assert.equal(low.body.result.percent, 37);
    assert.equal(low.body.result.grade, 2);
    assert.equal(low.body.result.passed, false);
    assert.equal(low.body.certificate, undefined);
    assert.deepEqual(await pupil.get('certificates').then((res) => res.body), []);
    const better = await scoreWork(name, 100, 100);
    assert.equal(better.body.result.passed, true);
    assert.ok(better.body.certificate);
  });

  test('a score must be a whole number from 0 to 100, for a step the student has done', async () => {
    const pupil = harness.client();
    const name = unique('unscored');
    await pupil.register(name);
    await finishUntilTask(pupil, moduleId);
    await pupil.post('progress', { module_id: moduleId, step_type: 'task', response: 'Rejam' });
    const [row] = await harness.sql`SELECT p.id FROM np_progress p JOIN np_users u ON u.id = p.user_id WHERE u.login=${`${name}@gmail.com`} AND p.module_id=${moduleId}`;
    const review = (body) => teacher.post('progress', { action: 'review', progress_id: row.id, ...body });
    assert.equal((await review({ step: 'task', score: 101 })).statusCode, 400);
    assert.equal((await review({ step: 'task', score: 7.5 })).statusCode, 400);
    assert.equal((await review({ step: 'task' })).statusCode, 400);
    assert.equal((await review({ step: 'refl', score: 50 })).statusCode, 409);
    const scored = await review({ step: 'task', score: 75 });
    assert.equal(scored.body.step_responses.reviews.task.score, 75);
    // Editing only the comment keeps the score.
    const commented = await review({ step: 'task', feedback: 'Batafsilroq yozing' });
    assert.equal(commented.body.step_responses.reviews.task.score, 75);
  });

  test('the grade scale follows the five-point system', () => {
    const { gradeFor } = require('../api/_grading');
    assert.deepEqual([100, 86, 85, 71, 70, 55, 54, 0].map((p) => gradeFor(p).grade), [5, 5, 4, 4, 3, 3, 2, 2]);
  });
});

describe('articles, images and public numbers', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

  test('the old guides are the first articles and the administrator writes new ones', async () => {
    const list = await harness.client().get('articles');
    assert.ok(list.body.some((a) => a.slug === 'darsni-rejalashtirish'));
    assert.equal((await teacher.post('articles', { title: 'Sarlavha', body: 'Yetarlicha uzun maqola matni shu yerda.' })).statusCode, 403);

    const created = await admin.post('articles', { title: 'O‘quv natijalarini qanday o‘lchash mumkin?', body: '**Muhim:** natijani o‘lchashdan oldin maqsadni yozing.', published: false });
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.slug, 'oquv-natijalarini-qanday-olchash-mumkin');
    assert.equal((await harness.client().get('articles', { slug: created.body.slug })).statusCode, 404);
    assert.equal((await admin.get('articles', { all: '1' })).body.find((a) => a.id === created.body.id).published, false);

    const again = await admin.post('articles', { title: 'O‘quv natijalarini qanday o‘lchash mumkin?', body: 'Ikkinchi maqola matni ham yetarlicha uzun.' });
    assert.equal(again.body.slug, 'oquv-natijalarini-qanday-olchash-mumkin-2');
    assert.equal((await admin.post('articles', { id: created.body.id, title: 'O‘quv natijalari', body: 'Yangilangan va e’lon qilingan matn.', published: true })).statusCode, 200);
    const article = await harness.client().get('articles', { slug: created.body.slug });
    assert.equal(article.body.title, 'O‘quv natijalari');
    assert.match(article.body.excerpt, /Yangilangan/);
    assert.equal((await admin.call('articles', { method: 'DELETE', query: { id: String(again.body.id) } })).statusCode, 200);
  });

  test('covers are checked images, served as they are, and a replaced cover is removed', async () => {
    assert.equal((await student.post('images', { mime: 'image/png', data: PNG.toString('base64') })).statusCode, 403);
    assert.equal((await teacher.post('images', { mime: 'image/png', data: PDF.toString('base64') })).statusCode, 415);
    const first = await teacher.post('images', { mime: 'image/png', data: PNG.toString('base64') });
    assert.equal(first.statusCode, 201);
    const served = await harness.client().get('images', { id: first.body.id });
    assert.equal(served.headers['content-type'], 'image/png');
    assert.match(served.headers['cache-control'], /immutable/);
    assert.deepEqual(Buffer.from(served.raw), PNG);

    assert.equal((await teacher.post('modules', { action: 'cover', id: moduleId, cover_image_id: first.body.id })).body.cover_image_id, first.body.id);
    const second = await teacher.post('images', { mime: 'image/png', data: PNG.toString('base64') });
    await teacher.post('modules', { action: 'cover', id: moduleId, cover_image_id: second.body.id });
    assert.equal((await harness.sql`SELECT 1 FROM np_images WHERE id=${first.body.id}::uuid`).length, 0);
    const outsider = harness.client();
    await outsider.register(unique('cover_outsider'), 'teacher');
    assert.equal((await outsider.post('modules', { action: 'cover', id: moduleId, cover_image_id: null })).statusCode, 403);
  });

  test('the home page numbers come from the database', async () => {
    const res = await harness.client().get('stats');
    assert.equal(res.statusCode, 200);
    const [{ n }] = await harness.sql`SELECT COUNT(*)::int AS n FROM np_modules WHERE deleted_at IS NULL`;
    assert.equal(res.body.modules, n);
    assert.ok(res.body.students >= 1 && res.body.teachers >= 1 && res.body.certificates >= 1);
    assert.match(res.headers['cache-control'], /s-maxage/);
  });
});

describe('action log', () => {
  test('approvals, deletions and content changes are recorded for the administrator', async () => {
    assert.equal((await teacher.get('audit')).statusCode, 403);
    const log = await admin.get('audit');
    assert.ok(log.body.total > log.body.items.length, 'the log is paged');
    const actions = new Set((await harness.sql`SELECT DISTINCT action FROM np_audit_log`).map((row) => row.action));
    for (const action of ['module.create', 'content.save', 'teacher.approve', 'account.delete', 'group.create', 'article.create', 'module.cover']) {
      assert.ok(actions.has(action), `missing ${action}`);
    }
    const entry = log.body.items[0];
    assert.ok(entry.actor_name && entry.action && entry.created_at);
    assert.equal((await admin.get('audit', { page: '2' })).body.page, 2);
  });
});
