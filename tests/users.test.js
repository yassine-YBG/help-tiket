// GET /api/auth/users (pagination, search, filters) and pending users.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, teardown, createUser } = require('./helpers');

let app;
let admin;
const list = (qs = '', token = admin.token) =>
  request(app).get(`/api/auth/users${qs}`).set('Authorization', `Bearer ${token}`);

before(async () => {
  app = await setup();
  admin = await createUser({ role: 'admin', username: 'boss', email: 'boss@test.com' });
  await createUser({ role: 'superadmin', username: 'zed', email: 'zed@test.com' });
  for (let i = 1; i <= 12; i++) await createUser({ username: `client${i}`, email: `client${i}@test.com` });
  await createUser({ username: 'waiting', email: 'waiting@test.com', activated: false });
  await createUser({ username: 'removed', email: 'removed@test.com', deleted: true });
});
after(teardown);

describe('GET /api/auth/users', () => {
  it('returns { users, pagination } without deleted users', async () => {
    const res = await list();
    assert.equal(res.status, 200);
    assert.equal(res.body.pagination.total, 15, '1 admin + 1 superadmin + 12 users + 1 pending');
    assert.ok(!res.body.users.some((u) => u.email === 'removed@test.com'));
    assert.ok(!JSON.stringify(res.body).includes('password'));
  });

  it('paginates', async () => {
    const p1 = await list('?limit=5');
    const p3 = await list('?limit=5&page=3');
    assert.equal(p1.body.users.length, 5);
    assert.equal(p1.body.pagination.totalPages, 3);
    assert.equal(p3.body.users.length, 5);
    assert.equal(p3.body.pagination.hasNextPage, false);
    const ids = new Set();
    for (const page of [1, 2, 3]) (await list(`?limit=5&page=${page}`)).body.users.forEach((u) => ids.add(u._id));
    assert.equal(ids.size, 15, 'no user repeated or skipped');
  });

  it('search in username, lastname, email (case-insensitive)', async () => {
    assert.equal((await list('?search=CLIENT1')).body.pagination.total, 4, 'client1, client10, client11, client12');
    assert.equal((await list('?search=boss@')).body.pagination.total, 1);
    assert.equal((await list(`?search=${encodeURIComponent('.*')}`)).body.pagination.total, 0, 'regex is literal');
  });

  it('filters by role and activation', async () => {
    assert.equal((await list('?role=admin,superadmin')).body.pagination.total, 2);
    assert.equal((await list('?activated=false')).body.pagination.total, 1);
    assert.equal((await list('?role=user&activated=true')).body.pagination.total, 12);
  });

  it('sorts by name', async () => {
    const names = (await list('?sort=name&limit=100')).body.users.map((u) => u.username);
    assert.deepEqual(names, [...names].sort());
  });

  it('bad values -> 400', async () => {
    for (const qs of ['?role=king', '?activated=yes', '?sort=age', '?limit=500', '?foo=1', '?search=', '?role[$ne]=x']) {
      assert.equal((await list(qs)).status, 400, qs);
    }
  });

  it('normal user -> 403', async () => {
    const u = await createUser();
    assert.equal((await list('', u.token)).status, 403);
  });
});

describe('GET /api/auth/users/pending', () => {
  it('lists only not-activated users', async () => {
    const res = await request(app).get('/api/auth/users/pending').set('Authorization', `Bearer ${admin.token}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((u) => u.email), ['waiting@test.com']);
  });
});

describe('deleted accounts list (to restore them)', () => {
  it('?deleted=true lists only deleted accounts; bad value -> 400', async () => {
    const res = await list('?deleted=true');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.users.map((u) => u.email), ['removed@test.com']);
    assert.equal(res.body.users[0].deleted, true);
    assert.equal((await list('?deleted=maybe')).status, 400);
    const normal = await list('?deleted=false');
    assert.ok(!normal.body.users.some((u) => u.email === 'removed@test.com'));
  });
});

describe('pending accounts counter (menu)', () => {
  it('GET /api/tickets/summary counts accounts waiting for activation', async () => {
    const res = await request(app).get('/api/tickets/summary').set('Authorization', `Bearer ${admin.token}`);
    assert.equal(res.body.pendingUsers, 1, 'only "waiting" (deleted accounts are not counted)');
  });
});
