// When a support account stops working (deactivated, deleted, demoted to "user"),
// its OPEN tickets go back to the team; resolved tickets keep their handler.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, teardown, createUser } = require('./helpers');

let app;
let boss; // superadmin doing the actions
let owner;
const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

const ticketHeldBy = async (handler, { resolve = false } = {}) => {
  const id = (await request(app).post('/api/tickets/create').set(auth(owner))
    .send({ subject: 'Held', description: 'd', category: 'c' })).body.ticketId;
  await request(app).put(`/api/tickets/assign/${id}`).set(auth(handler));
  if (resolve) await request(app).put(`/api/tickets/status/${id}`).set(auth(handler)).send({ status: 'résolu' });
  return id;
};
const handlerOf = async (id) => (await request(app).get(`/api/tickets/${id}`).set(auth(boss))).body.handledBy;

before(async () => {
  app = await setup();
  boss = await createUser({ role: 'superadmin', email: 'boss@test.com' });
  owner = await createUser({ email: 'owner@test.com' });
});
after(teardown);

describe('open tickets are released when support stops working', () => {
  it('deactivating an admin releases his open tickets, not the resolved ones', async () => {
    const malek = await createUser({ role: 'admin', email: 'malek@test.com' });
    const open = await ticketHeldBy(malek);
    const done = await ticketHeldBy(malek, { resolve: true });

    const res = await request(app).put(`/api/auth/users/${malek.id}/activation`).set(auth(boss)).send({ activated: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.ticketsReleased, 1);
    assert.equal(await handlerOf(open), null, 'open ticket is free again');
    assert.equal((await handlerOf(done)).email, 'malek@test.com', 'resolved ticket keeps its history');

    // re-activating does not release anything
    const back = await request(app).put(`/api/auth/users/${malek.id}/activation`).set(auth(boss)).send({ activated: true });
    assert.equal(back.body.ticketsReleased, 0);
  });

  it('deleting an admin releases his open tickets', async () => {
    const rami = await createUser({ role: 'admin', email: 'rami@test.com' });
    const open = await ticketHeldBy(rami);
    const res = await request(app).delete(`/api/auth/users/${rami.id}`).set(auth(boss));
    assert.equal(res.body.ticketsReleased, 1);
    assert.equal(await handlerOf(open), null);
  });

  it('demoting a superadmin to user releases his tickets (admins can take them again)', async () => {
    const sara = await createUser({ role: 'superadmin', email: 'sara@test.com' });
    const open = await ticketHeldBy(sara);
    const res = await request(app).put(`/api/auth/users/${sara.id}/role`).set(auth(boss)).send({ role: 'user' });
    assert.equal(res.body.ticketsReleased, 1);
    assert.equal(await handlerOf(open), null);

    const admin = await createUser({ role: 'admin', email: 'any-admin@test.com' });
    assert.equal((await request(app).put(`/api/tickets/assign/${open}`).set(auth(admin))).status, 200);
  });

  it('admin -> superadmin keeps the tickets', async () => {
    const nour = await createUser({ role: 'admin', email: 'nour-admin@test.com' });
    const open = await ticketHeldBy(nour);
    const res = await request(app).put(`/api/auth/users/${nour.id}/role`).set(auth(boss)).send({ role: 'superadmin' });
    assert.equal(res.body.ticketsReleased, 0);
    assert.equal((await handlerOf(open)).email, 'nour-admin@test.com');
  });

  it('a normal user has nothing to release', async () => {
    const u = await createUser({ email: 'plain@test.com' });
    const res = await request(app).put(`/api/auth/users/${u.id}/activation`).set(auth(boss)).send({ activated: false });
    assert.equal(res.body.ticketsReleased, 0);
  });
});
