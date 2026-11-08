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
    assert.equal((await person.get('auth')).body.user.login, login);
    await harness.sql`UPDATE np_users SET status='blocked' WHERE login=${login}`;
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
    const [row] = await harness.sql`SELECT id FROM np_users WHERE login='student_one'`;
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
    const [row] = await harness.sql`SELECT id FROM np_users WHERE login='teacher_one'`;
    const profile = await admin.get('users', { id: String(row.id) });
    assert.equal(profile.body.login, 'teacher_one');
    assert.equal(profile.body.password, undefined);
    assert.ok(profile.body.modules_created.length > 0);
    assert.equal((await admin.get('users', { id: '999999' })).statusCode, 404);
  });
});

describe('registration limit', () => {
  const attempt = (ip) => harness.client().call('auth', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: { action: 'register', name: 'Some Name', login: unique('limited'), password: 'a-valid-password' }
  });

  test('one address is stopped after ten registrations, others are not', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await attempt('203.0.113.7')).statusCode, 201);
    assert.equal((await attempt('203.0.113.7')).statusCode, 429);
    assert.equal((await attempt('203.0.113.8')).statusCode, 201);
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
