// One ticket's full life: create, read, reply, files, status, priority, archive.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, teardown, createUser, countUploads, wait } = require('./helpers');

let app;
let owner;
let other;
let admin;
let ticketId;
let fileId;

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

before(async () => {
  app = await setup();
  owner = await createUser({ email: 'owner@test.com' });
  other = await createUser({ email: 'other@test.com' });
  admin = await createUser({ role: 'admin', email: 'admin@test.com' });
});
after(teardown);

describe('create ticket', () => {
  it('with a file -> 201', async () => {
    const res = await request(app).post('/api/tickets/create').set(auth(owner))
      .field('subject', 'Login problem').field('description', 'Cannot log in')
      .field('category', 'YouTube').field('priority', 'high')
      .attach('attachments', Buffer.from('PNGDATA'), { filename: 'screen.png', contentType: 'image/png' });
    assert.equal(res.status, 201);
    assert.equal(res.body.attachmentsCount, 1);
    ticketId = res.body.ticketId;
  });

  it('forbidden file type -> 400', async () => {
    const res = await request(app).post('/api/tickets/create').set(auth(owner))
      .field('subject', 'x').field('description', 'y').field('category', 'z')
      .attach('attachments', Buffer.from('<script>'), { filename: 'evil.html', contentType: 'text/html' });
    assert.equal(res.status, 400);
  });

  it('missing subject -> 400 and the uploaded file is removed', async () => {
    const before = countUploads();
    const res = await request(app).post('/api/tickets/create').set(auth(owner))
      .field('description', 'no subject').field('category', 'z')
      .attach('attachments', Buffer.from('x'), { filename: 'a.png', contentType: 'image/png' });
    await wait(200);
    assert.equal(res.status, 400);
    assert.equal(countUploads(), before);
  });

  it('invalid priority -> 400', async () => {
    const res = await request(app).post('/api/tickets/create').set(auth(owner))
      .field('subject', 's').field('description', 'd').field('category', 'c').field('priority', 'super-urgent');
    assert.equal(res.status, 400);
  });

  it('the saved path never exposes the server folder', async () => {
    const res = await request(app).get(`/api/tickets/${ticketId}`).set(auth(admin));
    const savedPath = res.body.attachments[0].path;
    assert.ok(!savedPath.startsWith('/') && !/^[A-Z]:\\/i.test(savedPath), savedPath);
    fileId = res.body.attachments[0]._id;
  });
});

describe('get one ticket', () => {
  it('owner -> 200, admin -> 200, other user -> 403, bad id -> 400', async () => {
    assert.equal((await request(app).get(`/api/tickets/${ticketId}`).set(auth(owner))).status, 200);
    assert.equal((await request(app).get(`/api/tickets/${ticketId}`).set(auth(admin))).status, 200);
    assert.equal((await request(app).get(`/api/tickets/${ticketId}`).set(auth(other))).status, 403);
    assert.equal((await request(app).get('/api/tickets/abc').set(auth(admin))).status, 400);
  });
});

describe('download', () => {
  const url = () => `/api/tickets/${ticketId}/attachment/ticket/${fileId}/download`;

  it('other user -> 403', async () => {
    assert.equal((await request(app).get(url()).set(auth(other))).status, 403);
  });

  it('owner -> 200 with the right content and file name', async () => {
    const res = await request(app).get(url()).set(auth(owner)).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), 'PNGDATA');
    assert.match(res.headers['content-disposition'], /screen\.png/);
  });

  it('admin -> 200, bad type -> 400', async () => {
    assert.equal((await request(app).get(url()).set(auth(admin))).status, 200);
    const bad = `/api/tickets/${ticketId}/attachment/other/${fileId}/download`;
    assert.equal((await request(app).get(bad).set(auth(admin))).status, 400);
  });
});

describe('reply', () => {
  it('other user -> 403 and the uploaded file is removed', async () => {
    const before = countUploads();
    const res = await request(app).post(`/api/tickets/reply/${ticketId}`).set(auth(other))
      .field('message', 'hack').attach('attachments', Buffer.from('x'), { filename: 'b.png', contentType: 'image/png' });
    await wait(200);
    assert.equal(res.status, 403);
    assert.equal(countUploads(), before);
  });

  it('empty reply -> 400', async () => {
    const res = await request(app).post(`/api/tickets/reply/${ticketId}`).set(auth(admin)).send({ message: '   ' });
    assert.equal(res.status, 400);
  });

  it('an admin must be assigned before replying (no auto-assign), and sees who handles it', async () => {
    const before = countUploads();
    let res = await request(app).post(`/api/tickets/reply/${ticketId}`).set(auth(admin))
      .field('message', 'not mine yet')
      .attach('attachments', Buffer.from('x'), { filename: 'n.png', contentType: 'image/png' });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /Assign this ticket to yourself before you reply/);
    await wait(200);
    assert.equal(countUploads(), before, 'uploaded file removed');

    // another admin takes it: Malek cannot reply any more
    const admin2 = await createUser({ role: 'admin', email: 'reply-admin2@test.com', username: 'Sara' });
    await request(app).put(`/api/tickets/assign/${ticketId}`).set(auth(admin2));
    res = await request(app).post(`/api/tickets/reply/${ticketId}`).set(auth(admin)).send({ message: 'x' });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /handled by Sara\. Take it over/);

    // a superadmin follows the same rule
    const boss = await createUser({ role: 'superadmin', email: 'reply-super@test.com' });
    assert.equal((await request(app).post(`/api/tickets/reply/${ticketId}`).set(auth(boss)).send({ message: 'x' })).status, 403);

    // take it back -> allowed
    await request(app).put(`/api/tickets/assign/${ticketId}`).set(auth(admin));
    const t = (await request(app).get(`/api/tickets/${ticketId}`).set(auth(admin))).body;
    assert.equal(t.messages.length, 0, 'nothing was saved by the refused replies');
  });

  it('admin replies with a file, owner replies, owner downloads the reply file', async () => {
    let res = await request(app).post(`/api/tickets/reply/${ticketId}`).set(auth(admin))
      .field('message', 'Try again please')
      .attach('attachments', Buffer.from('PDF'), { filename: 'c.pdf', contentType: 'application/pdf' });
    assert.equal(res.status, 200);
    res = await request(app).post(`/api/tickets/reply/${ticketId}`).set(auth(owner)).send({ message: 'thanks' });
    assert.equal(res.status, 200);

    const ticket = (await request(app).get(`/api/tickets/${ticketId}`).set(auth(owner))).body;
    assert.equal(ticket.messages.length, 2);
    const replyFile = ticket.messages[0].attachments[0]._id;
    res = await request(app).get(`/api/tickets/${ticketId}/attachment/message/${replyFile}/download`).set(auth(owner));
    assert.equal(res.status, 200);
  });
});

describe('emails are hidden from normal users', () => {
  it('owner sees usernames only; admin sees emails', async () => {
    const asOwner = (await request(app).get(`/api/tickets/${ticketId}`).set(auth(owner))).body;
    assert.ok(asOwner.messages.every((m) => m.sender.username && m.sender.email === undefined));
    assert.ok(!JSON.stringify(asOwner).includes('admin@test.com'));

    const mine = (await request(app).get('/api/tickets/my').set(auth(owner))).body;
    assert.ok(!JSON.stringify(mine).includes('@test.com'));

    const asAdmin = (await request(app).get(`/api/tickets/${ticketId}`).set(auth(admin))).body;
    assert.equal(asAdmin.createdBy.email, 'owner@test.com');
  });
});

describe('status, priority, assign', () => {
  it('status: only the admin handling the ticket (no auto-assign any more)', async () => {
    const fresh = (await request(app).post('/api/tickets/create').set(auth(owner))
      .send({ subject: 'Status rule', description: 'd', category: 'c' })).body.ticketId;
    let res = await request(app).put(`/api/tickets/status/${fresh}`).set(auth(admin)).send({ status: 'en cours' });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /Assign this ticket to yourself before you change its status/);
    const t = (await request(app).get(`/api/tickets/${fresh}`).set(auth(admin))).body;
    assert.equal(t.handledBy, undefined, 'not auto-assigned');
    assert.equal(t.status, 'non résolu');

    const admin3 = await createUser({ role: 'admin', email: 'status-admin3@test.com', username: 'Rami' });
    await request(app).put(`/api/tickets/assign/${fresh}`).set(auth(admin3));
    res = await request(app).put(`/api/tickets/status/${fresh}`).set(auth(admin)).send({ status: 'résolu' });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /handled by Rami/);
    assert.equal((await request(app).put(`/api/tickets/status/${fresh}`).set(auth(admin3)).send({ status: 'résolu' })).status, 200);
  });

  it('status: validation and permissions', async () => {
    assert.equal((await request(app).put(`/api/tickets/status/${ticketId}`).set(auth(admin)).send({ status: 'closed' })).status, 400);
    assert.equal((await request(app).put('/api/tickets/status/abc').set(auth(admin)).send({ status: 'résolu' })).status, 400);
    assert.equal((await request(app).put(`/api/tickets/status/${ticketId}`).set(auth(owner)).send({ status: 'résolu' })).status, 403);
  });

  it('résolu saves resolvedAt; assign keeps résolu; reopening clears resolvedAt', async () => {
    assert.equal((await request(app).put(`/api/tickets/status/${ticketId}`).set(auth(admin)).send({ status: 'résolu' })).status, 200);
    let t = (await request(app).get(`/api/tickets/${ticketId}`).set(auth(admin))).body;
    assert.ok(t.resolvedAt);
    assert.equal(t.handledBy.email, 'admin@test.com');

    const assign = await request(app).put(`/api/tickets/assign/${ticketId}`).set(auth(admin));
    assert.equal(assign.body.status, 'résolu');

    await request(app).put(`/api/tickets/status/${ticketId}`).set(auth(admin)).send({ status: 'en cours' });
    t = (await request(app).get(`/api/tickets/${ticketId}`).set(auth(admin))).body;
    assert.equal(t.resolvedAt, null);
  });

  it('priority: owner yes, other user no, bad value 400', async () => {
    assert.equal((await request(app).put(`/api/tickets/priority/${ticketId}`).set(auth(owner)).send({ priority: 'max' })).status, 400);
    assert.equal((await request(app).put(`/api/tickets/priority/${ticketId}`).set(auth(other)).send({ priority: 'low' })).status, 403);
    assert.equal((await request(app).put(`/api/tickets/priority/${ticketId}`).set(auth(owner)).send({ priority: 'low' })).status, 200);
  });

  it('assign: admin only', async () => {
    assert.equal((await request(app).put(`/api/tickets/assign/${ticketId}`).set(auth(owner))).status, 403);
  });
});

describe('urgent priority is decided by the support team', () => {
  const create = (user, priority, withFile = false) => {
    const req = request(app).post('/api/tickets/create').set(auth(user))
      .field('subject', 'Urgent?').field('description', 'd').field('category', 'c').field('priority', priority);
    return withFile ? req.attach('attachments', Buffer.from('u'), { filename: 'u.png', contentType: 'image/png' }) : req;
  };
  const setPriority = (user, id, priority) =>
    request(app).put(`/api/tickets/priority/${id}`).set(auth(user)).send({ priority });

  it('a user cannot create an urgent ticket (403) and the uploaded file is removed', async () => {
    const before = countUploads();
    const res = await create(owner, 'urgent', true);
    await wait(200);
    assert.equal(res.status, 403);
    assert.match(res.body.error, /support team/);
    assert.equal(countUploads(), before);
  });

  it('a user can create low, normal and high tickets', async () => {
    for (const priority of ['low', 'normal', 'high']) {
      assert.equal((await create(owner, priority)).status, 201, priority);
    }
  });

  it('an admin can create an urgent ticket', async () => {
    assert.equal((await create(admin, 'urgent')).status, 201);
  });

  it('a user cannot raise a ticket to urgent; support can; then the user may keep or lower it, not raise it again', async () => {
    const id = (await create(owner, 'high')).body.ticketId;
    assert.equal((await setPriority(owner, id, 'urgent')).status, 403);
    await request(app).put(`/api/tickets/assign/${id}`).set(auth(admin));
    assert.equal((await setPriority(admin, id, 'urgent')).status, 200);
    assert.equal((await setPriority(owner, id, 'urgent')).status, 200, 'keeping urgent is fine');
    assert.equal((await setPriority(owner, id, 'normal')).status, 200, 'lowering is fine');
    assert.equal((await setPriority(owner, id, 'urgent')).status, 403, 'raising again is not');
  });
});

describe('text limits', () => {
  const create = (fields) => {
    const all = { subject: 's', description: 'd', category: 'c', ...fields };
    let req = request(app).post('/api/tickets/create').set(auth(owner));
    for (const [k, v] of Object.entries(all)) req = req.field(k, v);
    return req;
  };

  it('subject 150 / category 50 / description 5000 characters are accepted', async () => {
    const res = await create({ subject: 'a'.repeat(150), category: 'b'.repeat(50), description: 'c'.repeat(5000) });
    assert.equal(res.status, 201);
  });

  it('one character more is refused with a clear message', async () => {
    for (const [field, max] of [['subject', 150], ['category', 50], ['description', 5000]]) {
      const res = await create({ [field]: 'x'.repeat(max + 1) });
      assert.equal(res.status, 400, field);
      assert.equal(res.body.error, `"${field}" must be at most ${max} characters`);
    }
  });

  it('spaces around the text do not count', async () => {
    assert.equal((await create({ subject: `   ${'a'.repeat(150)}   ` })).status, 201);
  });

  it('a reply longer than 5000 characters is refused', async () => {
    const id = (await create({})).body.ticketId;
    const tooLong = await request(app).post(`/api/tickets/reply/${id}`).set(auth(owner)).send({ message: 'm'.repeat(5001) });
    assert.equal(tooLong.status, 400);
    const ok = await request(app).post(`/api/tickets/reply/${id}`).set(auth(owner)).send({ message: 'm'.repeat(5000) });
    assert.equal(ok.status, 200);
  });
});

describe('archive ("closed by support")', () => {
  let admin2;
  let superadmin;
  let id;

  const newTicket = async () =>
    (await request(app).post('/api/tickets/create').set(auth(owner))
      .send({ subject: 'Archive me', description: 'd', category: 'c' })).body.ticketId;
  const archive = (who, ticket = id) => request(app).put(`/api/tickets/archive/${ticket}`).set(auth(who));
  const unarchive = (who, ticket = id) => request(app).put(`/api/tickets/unarchive/${ticket}`).set(auth(who));
  const setStatus = (who, status, ticket = id) =>
    request(app).put(`/api/tickets/status/${ticket}`).set(auth(who)).send({ status });
  const adminListIds = async (query = '') =>
    (await request(app).get(`/api/tickets?limit=100${query}`).set(auth(admin))).body.tickets.map((t) => t._id);

  before(async () => {
    admin2 = await createUser({ role: 'admin', email: 'admin2@test.com' });
    superadmin = await createUser({ role: 'superadmin', email: 'super@test.com' });
    id = await newTicket();
  });

  it('the old DELETE route is gone', async () => {
    assert.equal((await request(app).delete(`/api/tickets/${id}`).set(auth(admin))).status, 404);
  });

  it('a normal user -> 403', async () => {
    assert.equal((await archive(owner)).status, 403);
    assert.equal((await unarchive(owner)).status, 403);
  });

  it('not handled by anyone -> 403 for an admin', async () => {
    const res = await archive(admin);
    assert.equal(res.status, 403);
  });

  it('handled but not resolved -> 400', async () => {
    await request(app).put(`/api/tickets/assign/${id}`).set(auth(admin));
    const res = await archive(admin);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Only resolved tickets/);
  });

  it('resolved, but another admin (not the handler) -> 403', async () => {
    await setStatus(admin, 'résolu');
    assert.equal((await archive(admin2)).status, 403);
  });

  it('the handler archives it -> 200, hidden from the admin list only', async () => {
    const res = await archive(admin);
    assert.equal(res.status, 200);
    assert.ok(res.body.archivedAt);
    assert.equal((await archive(admin)).status, 400, 'already archived');

    assert.ok(!(await adminListIds()).includes(id), 'hidden by default');
    assert.ok((await adminListIds('&archived=only')).includes(id));
    assert.ok((await adminListIds('&archived=include')).includes(id));
    const onlyArchived = (await request(app).get('/api/tickets?archived=only').set(auth(admin))).body.tickets;
    assert.ok(onlyArchived.every((t) => t.archived === true), 'only archived ones');
    assert.equal((await request(app).get('/api/tickets?archived=yes').set(auth(admin))).status, 400);
  });

  it('the owner still sees it, marked archived', async () => {
    const one = await request(app).get(`/api/tickets/${id}`).set(auth(owner));
    assert.equal(one.status, 200);
    assert.equal(one.body.archived, true);
    const mine = (await request(app).get('/api/tickets/my?limit=100').set(auth(owner))).body.tickets;
    assert.ok(mine.some((t) => t._id === id));
    // ...and the owner cannot use the admin filter
    assert.equal((await request(app).get('/api/tickets/my?archived=only').set(auth(owner))).status, 400);
  });

  it('nobody can write in an archived (resolved) ticket, and uploaded files are removed', async () => {
    const before = countUploads();
    const byOwner = await request(app).post(`/api/tickets/reply/${id}`).set(auth(owner))
      .field('message', 'still broken')
      .attach('attachments', Buffer.from('X'), { filename: 'x.png', contentType: 'image/png' });
    assert.equal(byOwner.status, 400);
    assert.match(byOwner.body.error, /open a new ticket/);
    await wait(200);
    assert.equal(countUploads(), before);
    assert.equal((await request(app).post(`/api/tickets/reply/${id}`).set(auth(admin)).send({ message: 'x' })).status, 400);
    assert.ok(!(await adminListIds()).includes(id), 'still archived');
  });

  it('reopening (status not resolved) brings it back', async () => {
    // still archived from the tests above
    const res = await setStatus(admin, 'en cours');
    assert.equal(res.status, 200);
    assert.equal(res.body.archived, false);
    assert.ok((await adminListIds()).includes(id));
  });

  it('a superadmin can archive and restore any resolved ticket', async () => {
    await setStatus(admin, 'résolu');
    assert.equal((await archive(superadmin)).status, 200);
    assert.equal((await unarchive(admin2)).status, 403, 'not the handler');
    assert.equal((await unarchive(superadmin)).status, 200);
    assert.equal((await unarchive(superadmin)).status, 400, 'not archived any more');
    assert.ok((await adminListIds()).includes(id));
  });

  it('bad id -> 400, unknown id -> 404', async () => {
    assert.equal((await archive(admin, 'abc')).status, 400);
    assert.equal((await archive(admin, '0123456789abcdef01234567')).status, 404);
  });

  it('the files stay on disk', async () => {
    const before = countUploads();
    await request(app).put(`/api/tickets/assign/${ticketId}`).set(auth(admin));
    assert.equal((await setStatus(admin, 'résolu', ticketId)).status, 200);
    assert.equal((await archive(admin, ticketId)).status, 200);
    assert.equal(countUploads(), before);
  });
});

describe('who must act next (alerts)', () => {
  let id;
  let owner2; // a fresh owner so the counters only see this test's tickets
  const get = async (who = admin) => (await request(app).get(`/api/tickets/${id}`).set(auth(who))).body;
  const reply = (who, message = 'hello') => request(app).post(`/api/tickets/reply/${id}`).set(auth(who)).send({ message });
  const summary = async (who) => (await request(app).get('/api/tickets/summary').set(auth(who))).body;
  const seen = (who) => request(app).put(`/api/tickets/seen/${id}`).set(auth(who));

  before(async () => {
    owner2 = await createUser({ email: 'alerts-owner@test.com' });
    id = (await request(app).post('/api/tickets/create').set(auth(owner2))
      .send({ subject: 'Alerts', description: 'd', category: 'c' })).body.ticketId;
  });

  it('a new ticket waits for support; the owner has no new answer yet', async () => {
    const t = await get();
    assert.equal(t.awaitingSupport, true);
    assert.equal(t.supportUpdatedAt, null);
    assert.deepEqual(await summary(owner2), { newAnswers: 0 });
    const s = await summary(admin);
    assert.ok(s.needsReply >= 1);
    assert.equal(typeof s.needsReplyMine, 'number');
    assert.equal(typeof s.pendingUsers, 'number', 'pending accounts counter for the menu');
  });

  it('"needs reply" filter on the admin list (not for users)', async () => {
    const ids = (await request(app).get('/api/tickets?awaitingSupport=true&limit=100').set(auth(admin))).body.tickets.map((t) => t._id);
    assert.ok(ids.includes(id));
    assert.equal((await request(app).get('/api/tickets?awaitingSupport=false').set(auth(admin))).status, 400);
    assert.equal((await request(app).get('/api/tickets/my?awaitingSupport=true').set(auth(owner2))).status, 400);
  });

  it('support assigns -> the owner gets a new answer; mine counter counts it', async () => {
    const before = (await summary(admin)).needsReplyMine;
    await request(app).put(`/api/tickets/assign/${id}`).set(auth(admin));
    assert.equal((await summary(admin)).needsReplyMine, before + 1, 'still needs a reply, now mine');
    assert.deepEqual(await summary(owner2), { newAnswers: 1 });
  });

  it('support replies -> no longer waiting for support', async () => {
    assert.equal((await reply(admin, 'Try again please')).status, 200);
    const t = await get();
    assert.equal(t.awaitingSupport, false);
    assert.ok(t.supportUpdatedAt);
    const ids = (await request(app).get('/api/tickets?awaitingSupport=true&limit=100').set(auth(admin))).body.tickets.map((x) => x._id);
    assert.ok(!ids.includes(id));
  });

  it('the owner opens it -> the new answer is gone; only the owner can mark it seen', async () => {
    assert.equal((await seen(admin)).status, 403);
    assert.equal((await seen(other)).status, 403);
    assert.equal((await request(app).put('/api/tickets/seen/abc').set(auth(owner2))).status, 400);
    const res = await seen(owner2);
    assert.equal(res.status, 200);
    assert.ok(res.body.ownerSeenAt);
    assert.deepEqual(await summary(owner2), { newAnswers: 0 });
  });

  it('reading the ticket (GET) does not change anything', async () => {
    const before = await get(owner2);
    await get(owner2);
    assert.equal((await get(owner2)).ownerSeenAt, before.ownerSeenAt);
  });

  it('the owner replies -> waits for support again', async () => {
    await wait(5);
    assert.equal((await reply(owner2, 'Still broken')).status, 200);
    assert.equal((await get()).awaitingSupport, true);
    assert.deepEqual(await summary(owner2), { newAnswers: 0 }, 'own message is not a new answer');
  });

  it('resolving closes it: nobody waits, nobody can write', async () => {
    await wait(5);
    await request(app).put(`/api/tickets/status/${id}`).set(auth(admin)).send({ status: 'résolu' });
    const t = await get();
    assert.equal(t.awaitingSupport, false);
    assert.deepEqual(await summary(owner2), { newAnswers: 1 }, 'the owner is told it was resolved');
    assert.equal((await reply(owner2)).status, 400);
    assert.equal((await reply(admin)).status, 400);
  });

  it('support reopens it -> everyone can write again', async () => {
    await request(app).put(`/api/tickets/status/${id}`).set(auth(admin)).send({ status: 'en cours' });
    assert.equal((await reply(owner2, 'thanks for reopening')).status, 200);
    assert.equal((await get()).awaitingSupport, true);
  });

  it('a normal user cannot read the admin counters', async () => {
    const s = await summary(owner2);
    assert.equal(s.needsReply, undefined);
    assert.equal(s.pendingUsers, undefined);
  });
});

describe('priority by support + tickets held by a superadmin', () => {
  let malek;
  let rami;
  let sara;
  let other2;
  const newTicket = async () =>
    (await request(app).post('/api/tickets/create').set(auth(other2))
      .send({ subject: 'Lock', description: 'd', category: 'c' })).body.ticketId;
  const assign = (who, id) => request(app).put(`/api/tickets/assign/${id}`).set(auth(who));
  const priority = (who, id, p) => request(app).put(`/api/tickets/priority/${id}`).set(auth(who)).send({ priority: p });

  before(async () => {
    malek = await createUser({ role: 'admin', email: 'lock-malek@test.com', username: 'Malek' });
    rami = await createUser({ role: 'admin', email: 'lock-rami@test.com', username: 'Rami' });
    sara = await createUser({ role: 'superadmin', email: 'lock-sara@test.com', username: 'Sara' });
    other2 = await createUser({ email: 'lock-owner@test.com' });
  });

  it('support changes the priority only on a ticket assigned to them', async () => {
    const id = await newTicket();
    let res = await priority(malek, id, 'high');
    assert.equal(res.status, 403);
    assert.match(res.body.error, /Assign this ticket to yourself before you change its priority/);

    await assign(rami, id);
    res = await priority(malek, id, 'high');
    assert.equal(res.status, 403);
    assert.match(res.body.error, /handled by Rami/);

    assert.equal((await priority(rami, id, 'urgent')).status, 200);
    assert.equal((await priority(other2, id, 'low')).status, 200, 'the owner still can (lowering)');
  });

  it('an admin cannot take a ticket held by a superadmin', async () => {
    const id = await newTicket();
    assert.equal((await assign(sara, id)).status, 200);
    const res = await assign(malek, id);
    assert.equal(res.status, 403);
    assert.match(res.body.error, /handled by Sara \(superadmin\)\. Admins cannot take it over/);
    const t = (await request(app).get(`/api/tickets/${id}`).set(auth(malek))).body;
    assert.equal(t.handledBy.username, 'Sara', 'still Sara');
    assert.equal(t.handledBy.role, 'superadmin', 'support sees the role');
  });

  it('another superadmin can take it; a superadmin can take any admin ticket', async () => {
    const boss2 = await createUser({ role: 'superadmin', email: 'lock-boss2@test.com' });
    const id = await newTicket();
    await assign(sara, id);
    assert.equal((await assign(boss2, id)).status, 200);

    const id2 = await newTicket();
    await assign(malek, id2);
    assert.equal((await assign(sara, id2)).status, 200);
    // and from there Malek cannot take it back
    assert.equal((await assign(malek, id2)).status, 403);
  });

  it('a user never sees roles or emails of support', async () => {
    const id = await newTicket();
    await assign(sara, id);
    const t = (await request(app).get(`/api/tickets/${id}`).set(auth(other2))).body;
    assert.equal(t.handledBy.role, undefined);
    assert.equal(t.handledBy.email, undefined);
  });
});
