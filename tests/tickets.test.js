// One ticket's full life: create, read, reply, files, status, priority, delete.
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
  it('status: validation and permissions', async () => {
    assert.equal((await request(app).put(`/api/tickets/status/${ticketId}`).set(auth(admin)).send({ status: 'closed' })).status, 400);
    assert.equal((await request(app).put('/api/tickets/status/abc').set(auth(admin)).send({ status: 'résolu' })).status, 400);
    assert.equal((await request(app).put(`/api/tickets/status/${ticketId}`).set(auth(owner)).send({ status: 'résolu' })).status, 403);
  });

  it('résolu saves resolvedAt; assign keeps résolu; reopening clears resolvedAt', async () => {
    assert.equal((await request(app).put(`/api/tickets/status/${ticketId}`).set(auth(admin)).send({ status: 'résolu' })).status, 200);
    let t = (await request(app).get(`/api/tickets/${ticketId}`).set(auth(admin))).body;
    assert.ok(t.resolvedAt);
    assert.equal(t.handledBy.email, 'admin@test.com', 'auto-assigned');

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

describe('delete ticket', () => {
  it('user -> 403; bad deleteFiles value -> 400', async () => {
    assert.equal((await request(app).delete(`/api/tickets/${ticketId}`).set(auth(owner))).status, 403);
    assert.equal((await request(app).delete(`/api/tickets/${ticketId}?deleteFiles=yes`).set(auth(admin))).status, 400);
  });

  it('default delete keeps the files on disk', async () => {
    const created = await request(app).post('/api/tickets/create').set(auth(owner))
      .field('subject', 'keep').field('description', 'd').field('category', 'c')
      .attach('attachments', Buffer.from('K'), { filename: 'k.png', contentType: 'image/png' });
    const before = countUploads();
    const res = await request(app).delete(`/api/tickets/${created.body.ticketId}`).set(auth(admin));
    assert.equal(res.status, 200);
    assert.equal(res.body.filesDeleted, 0);
    assert.equal(countUploads(), before);
  });

  it('deleteFiles=true removes the ticket files AND reply files', async () => {
    const before = countUploads(); // ticket has 1 file + 1 reply file
    const res = await request(app).delete(`/api/tickets/${ticketId}?deleteFiles=true`).set(auth(admin));
    assert.equal(res.status, 200);
    assert.equal(res.body.filesDeleted, 2);
    assert.equal(countUploads(), before - 2);
  });

  it('a deleted ticket is gone from reads and lists', async () => {
    assert.equal((await request(app).get(`/api/tickets/${ticketId}`).set(auth(owner))).status, 404);
    const mine = (await request(app).get('/api/tickets/my').set(auth(owner))).body;
    assert.ok(!mine.tickets.some((t) => t._id === ticketId));
  });
});
