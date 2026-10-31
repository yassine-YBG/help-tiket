// GET /api/activity-logs (pagination + filters)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, teardown, createUser } = require('./helpers');

let app;
let admin;
let user;
const logs = (qs = '', u = admin) => request(app).get(`/api/activity-logs${qs}`).set('Authorization', `Bearer ${u.token}`);

before(async () => {
  app = await setup();
  admin = await createUser({ role: 'admin' });
  user = await createUser();
  // real actions that write logs: 1 ticket created by the user + 2 admin actions
  const created = await request(app).post('/api/tickets/create').set('Authorization', `Bearer ${user.token}`)
    .field('subject', 's').field('description', 'd').field('category', 'c');
  await request(app).put(`/api/tickets/assign/${created.body.ticketId}`).set('Authorization', `Bearer ${admin.token}`);
  const other = await createUser();
  await request(app).put(`/api/auth/users/${other.id}/activation`).set('Authorization', `Bearer ${admin.token}`).send({ activated: false });
});
after(teardown);

describe('GET /api/activity-logs', () => {
  it('returns { logs, pagination }, newest first, with targetModel', async () => {
    const res = await logs();
    assert.equal(res.status, 200);
    assert.equal(res.body.pagination.total, 3);
    assert.ok(res.body.logs.every((l) => l.targetModel));
    const t = res.body.logs.map((l) => new Date(l.timestamp).getTime());
    assert.ok(t.every((x, i) => i === 0 || t[i - 1] >= x));
  });

  it('paginates', async () => {
    const res = await logs('?limit=2');
    assert.equal(res.body.logs.length, 2);
    assert.equal(res.body.pagination.hasNextPage, true);
  });

  it('filters by user and targetModel', async () => {
    assert.equal((await logs(`?user=${user.id}`)).body.pagination.total, 1);
    assert.equal((await logs('?targetModel=User')).body.pagination.total, 1);
    assert.equal((await logs('?targetModel=Ticket')).body.pagination.total, 2);
  });

  it('bad filters -> 400, normal user -> 403', async () => {
    for (const qs of ['?user=abc', '?targetModel=Car', '?foo=1', '?limit=1000']) {
      assert.equal((await logs(qs)).status, 400, qs);
    }
    assert.equal((await logs('', user)).status, 403);
  });
});
