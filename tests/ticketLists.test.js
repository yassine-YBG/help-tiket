// GET /api/tickets and /api/tickets/my: pagination, filters, search, sort, security.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, teardown, createUser } = require('./helpers');

let app;
let admin;
let alice;
let bob;

const prios = ['low', 'normal', 'high', 'urgent'];
const list = (qs = '', user = admin) =>
  request(app).get(`/api/tickets${qs}`).set('Authorization', `Bearer ${user.token}`);

before(async () => {
  app = await setup();
  const Ticket = require('../models/Ticket');
  admin = await createUser({ role: 'admin' });
  alice = await createUser();
  bob = await createUser();

  // 25 tickets: 15 for Alice, 10 for Bob, created Jan 1..25 2026
  await Ticket.insertMany(Array.from({ length: 25 }, (_, i) => ({
    subject: i === 0 ? 'Login problem' : `Ticket ${i + 1}`,
    description: i === 3 ? 'price is 5.99 (a*b)' : 'some description',
    category: i % 2 ? 'Netflix' : 'Spotify',
    priority: prios[i % 4],
    status: i < 3 ? 'résolu' : 'non résolu',
    handledBy: i < 5 ? admin.user._id : undefined,
    createdBy: i < 15 ? alice.user._id : bob.user._id,
    createdAt: new Date(Date.UTC(2026, 0, i + 1, 10)),
  })));
});
after(teardown);

describe('pagination', () => {
  it('returns { tickets, pagination, sort } with default limit 20', async () => {
    const res = await list();
    assert.equal(res.status, 200);
    assert.equal(res.body.tickets.length, 20);
    assert.equal(res.body.pagination.total, 25);
    assert.equal(res.body.sort, 'newest');
  });

  it('pages never repeat or skip a ticket', async () => {
    const ids = new Set();
    for (const page of [1, 2, 3]) {
      const res = await list(`?limit=10&page=${page}`);
      res.body.tickets.forEach((t) => ids.add(t._id));
      if (page === 3) {
        assert.equal(res.body.tickets.length, 5);
        assert.equal(res.body.pagination.hasNextPage, false);
      }
    }
    assert.equal(ids.size, 25);
  });

  it('page after the end -> empty list, same total', async () => {
    const res = await list('?page=99');
    assert.equal(res.body.tickets.length, 0);
    assert.equal(res.body.pagination.total, 25);
  });

  it('bad page/limit -> 400', async () => {
    for (const qs of ['?limit=101', '?limit=0', '?page=0', '?page=abc', '?page=1.5', '?limit=-5']) {
      assert.equal((await list(qs)).status, 400, qs);
    }
  });

  it('keeps populated names and virtuals', async () => {
    const t = (await list('?limit=1')).body.tickets[0];
    assert.ok(t.createdBy.username);
    assert.equal(t.id, t._id);
    assert.equal(typeof t.priorityWeight, 'number');
  });
});

describe('filters', () => {
  const total = async (qs, user) => (await list(qs, user)).body.pagination.total;

  it('status (one or several)', async () => {
    assert.equal(await total(`?status=${encodeURIComponent('résolu')}`), 3);
    assert.equal(await total(`?status=${encodeURIComponent('non résolu,en cours')}`), 22);
  });

  it('priority', async () => {
    const res = await list('?priority=urgent&limit=100');
    assert.ok(res.body.tickets.length > 0 && res.body.tickets.every((t) => t.priority === 'urgent'));
  });

  it('category: exact name, any case', async () => {
    assert.equal(await total('?category=netflix'), 12);
    assert.equal(await total('?category=net'), 0);
  });

  it('search: subject or description, literal text', async () => {
    assert.equal(await total('?search=LOGIN'), 1);
    assert.equal(await total(`?search=${encodeURIComponent('5.99 (a*b)')}`), 1);
    assert.equal(await total(`?search=${encodeURIComponent('.*')}`), 0);
  });

  it('date range (to = whole day)', async () => {
    assert.equal(await total('?from=2026-01-05&to=2026-01-10'), 6);
  });

  it('handledBy (me / none) and createdBy', async () => {
    assert.equal(await total('?handledBy=me'), 5);
    assert.equal(await total('?handledBy=none'), 20);
    assert.equal(await total(`?createdBy=${bob.id}`), 10);
  });

  it('filters combine', async () => {
    const res = await list(`?createdBy=${bob.id}&category=netflix&priority=${encodeURIComponent('urgent,low')}`);
    assert.equal(res.body.pagination.total, 3);
    assert.ok(res.body.tickets.every((t) => t.category === 'Netflix' && ['urgent', 'low'].includes(t.priority)));
  });

  it('bad values -> 400', async () => {
    for (const qs of ['?status=closed', '?from=yesterday', '?from=2026-02-01&to=2026-01-01', '?sort=random', '?foo=bar']) {
      assert.equal((await list(qs)).status, 400, qs);
    }
  });
});

describe('sort', () => {
  it('priority: urgent first, correct ACROSS pages', async () => {
    const weights = [];
    for (const page of [1, 2, 3]) {
      weights.push(...(await list(`?sort=priority&limit=10&page=${page}`)).body.tickets.map((t) => t.priorityWeight));
    }
    assert.equal(weights.length, 25);
    assert.ok(weights.every((w, i) => i === 0 || weights[i - 1] >= w), weights.join());
  });

  it('oldest: ascending dates', async () => {
    const dates = (await list('?sort=oldest&limit=100')).body.tickets.map((t) => new Date(t.createdAt).getTime());
    assert.ok(dates.every((d, i) => i === 0 || dates[i - 1] <= d));
  });
});

describe('security', () => {
  it('NoSQL injection and repeated params -> 400', async () => {
    assert.equal((await list('?status[$ne]=x')).status, 400);
    assert.equal((await list('?status=en%20cours&status=r%C3%A9solu')).status, 400);
  });

  it('a normal user cannot list all tickets', async () => {
    assert.equal((await list('', alice)).status, 403);
  });
});

describe('/my', () => {
  it('only my tickets, paginated, sorted by priority by default', async () => {
    const res = await list('/my?limit=100', alice);
    assert.equal(res.body.pagination.total, 15);
    assert.equal(res.body.sort, 'priority');
    const w = res.body.tickets.map((t) => t.priorityWeight);
    assert.ok(w.every((x, i) => i === 0 || w[i - 1] >= x));
  });

  it('admin-only filters are refused', async () => {
    assert.equal((await list('/my?handledBy=none', alice)).status, 400);
    assert.equal((await list(`/my?createdBy=${bob.id}`, alice)).status, 400);
  });

  it('user with no tickets -> empty list', async () => {
    const nobody = await createUser();
    const res = await list('/my', nobody);
    assert.equal(res.body.tickets.length, 0);
    assert.equal(res.body.pagination.totalPages, 1);
  });
});
