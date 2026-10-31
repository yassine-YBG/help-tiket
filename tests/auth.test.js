// Register, login, "me", change password, account rules.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { setup, teardown, createUser, PASSWORD } = require('./helpers');

let app;
before(async () => { app = await setup(); });
after(teardown);

describe('register', () => {
  it('creates a user that is NOT activated -> 201', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'Ali', lastname: 'Ben', email: 'ali@test.com', password: PASSWORD });
    assert.equal(res.status, 201);
    const saved = await mongoose.connection.db.collection('users').findOne({ email: 'ali@test.com' });
    assert.equal(saved.activated, false);
    assert.equal(saved.role, 'user');
    assert.notEqual(saved.password, PASSWORD, 'password must be hashed');
  });

  it('ignores a "role" sent in the body', async () => {
    await request(app).post('/api/auth/register')
      .send({ username: 'H', lastname: 'X', email: 'hacker@test.com', password: PASSWORD, role: 'superadmin' });
    const saved = await mongoose.connection.db.collection('users').findOne({ email: 'hacker@test.com' });
    assert.equal(saved.role, 'user');
  });

  it('missing password -> 400', async () => {
    const res = await request(app).post('/api/auth/register').send({ username: 'A', lastname: 'B', email: 'a@test.com' });
    assert.equal(res.status, 400);
  });

  it('bad email -> 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'A', lastname: 'B', email: 'not-an-email', password: PASSWORD });
    assert.equal(res.status, 400);
  });

  it('short password -> 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'A', lastname: 'B', email: 'short@test.com', password: '123' });
    assert.equal(res.status, 400);
  });

  it('duplicate email (any case) -> 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'A', lastname: 'B', email: 'ALI@test.com', password: PASSWORD });
    assert.equal(res.status, 400);
  });
});

describe('login', () => {
  it('not activated + wrong password -> 401 (does not reveal the account)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ali@test.com', password: 'wrongpass' });
    assert.equal(res.status, 401);
  });

  it('not activated + right password -> 403', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ali@test.com', password: PASSWORD });
    assert.equal(res.status, 403);
  });

  it('activated -> 200 with token and user', async () => {
    const { user } = await createUser({ email: 'ok@test.com' });
    const res = await request(app).post('/api/auth/login').send({ email: 'OK@test.com', password: PASSWORD });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, user.email);
    assert.equal(res.body.user.password, undefined);
  });

  it('deleted user -> 401', async () => {
    await createUser({ email: 'gone@test.com', deleted: true });
    const res = await request(app).post('/api/auth/login').send({ email: 'gone@test.com', password: PASSWORD });
    assert.equal(res.status, 401);
  });

  it('missing fields -> 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ok@test.com' });
    assert.equal(res.status, 400);
  });
});

describe('tokens', () => {
  it('no token -> 401, fake token -> 401', async () => {
    assert.equal((await request(app).get('/api/auth/me')).status, 401);
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi');
    assert.equal(res.status, 401);
  });

  it('deactivated user: old token stops working immediately', async () => {
    const admin = await createUser({ role: 'admin' });
    const u = await createUser();
    await request(app).put(`/api/auth/users/${u.id}/activation`)
      .set('Authorization', `Bearer ${admin.token}`).send({ activated: false });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${u.token}`);
    assert.equal(res.status, 401);
  });

  it('demoted admin: old token loses admin access immediately', async () => {
    const superadmin = await createUser({ role: 'superadmin' });
    const admin = await createUser({ role: 'admin' });
    await request(app).put(`/api/auth/users/${admin.id}/role`)
      .set('Authorization', `Bearer ${superadmin.token}`).send({ role: 'user' });
    const res = await request(app).get('/api/tickets').set('Authorization', `Bearer ${admin.token}`);
    assert.equal(res.status, 403);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user without the password', async () => {
    const u = await createUser({ role: 'admin' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${u.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, u.user.email);
    assert.equal(res.body.user.role, 'admin');
    assert.ok(!JSON.stringify(res.body).includes('password'));
  });
});

describe('PUT /api/auth/me/password', () => {
  it('validates input', async () => {
    const u = await createUser();
    const send = (body) => request(app).put('/api/auth/me/password').set('Authorization', `Bearer ${u.token}`).send(body);
    assert.equal((await send({ currentPassword: 'wrong-one', newPassword: 'newsecret456' })).status, 401);
    assert.equal((await send({ currentPassword: PASSWORD, newPassword: '123' })).status, 400);
    assert.equal((await send({ currentPassword: PASSWORD, newPassword: PASSWORD })).status, 400);
    assert.equal((await send({ currentPassword: PASSWORD })).status, 400);
  });

  it('changes the password, logs out old tokens, returns a new one', async () => {
    const u = await createUser({ email: 'changer@test.com' });
    const res = await request(app).put('/api/auth/me/password')
      .set('Authorization', `Bearer ${u.token}`).send({ currentPassword: PASSWORD, newPassword: 'newsecret456' });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);

    const old = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${u.token}`);
    assert.equal(old.status, 401, 'old token must be refused');

    const fresh = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    assert.equal(fresh.status, 200);

    const login = await request(app).post('/api/auth/login').send({ email: 'changer@test.com', password: 'newsecret456' });
    assert.equal(login.status, 200);
  });
});

describe('admin rules on accounts', () => {
  it('admin can manage users but not admins/superadmins or themselves', async () => {
    const admin = await createUser({ role: 'admin' });
    const other = await createUser({ role: 'admin' });
    const superadmin = await createUser({ role: 'superadmin' });
    const user = await createUser();
    const auth = { Authorization: `Bearer ${admin.token}` };

    assert.equal((await request(app).put(`/api/auth/users/${superadmin.id}/activation`).set(auth).send({ activated: false })).status, 403);
    assert.equal((await request(app).put(`/api/auth/users/${other.id}/activation`).set(auth).send({ activated: false })).status, 403);
    assert.equal((await request(app).put(`/api/auth/users/${admin.id}/activation`).set(auth).send({ activated: false })).status, 403);
    assert.equal((await request(app).put(`/api/auth/users/${user.id}/activation`).set(auth).send({ activated: 'yes' })).status, 400);
    assert.equal((await request(app).put(`/api/auth/users/${user.id}/activation`).set(auth).send({ activated: false })).status, 200);
    assert.equal((await request(app).put('/api/auth/users/not-an-id/activation').set(auth).send({ activated: true })).status, 400);
  });

  it('only a superadmin changes roles, never their own', async () => {
    const admin = await createUser({ role: 'admin' });
    const superadmin = await createUser({ role: 'superadmin' });
    const user = await createUser();
    assert.equal((await request(app).put(`/api/auth/users/${user.id}/role`).set('Authorization', `Bearer ${admin.token}`).send({ role: 'admin' })).status, 403);
    assert.equal((await request(app).put(`/api/auth/users/${superadmin.id}/role`).set('Authorization', `Bearer ${superadmin.token}`).send({ role: 'user' })).status, 403);
    assert.equal((await request(app).put(`/api/auth/users/${user.id}/role`).set('Authorization', `Bearer ${superadmin.token}`).send({ role: 'boss' })).status, 400);
    assert.equal((await request(app).put(`/api/auth/users/${user.id}/role`).set('Authorization', `Bearer ${superadmin.token}`).send({ role: 'admin' })).status, 200);
  });

  it('delete = soft delete; restore brings the user back', async () => {
    const admin = await createUser({ role: 'admin' });
    const u = await createUser({ email: 'soft@test.com' });
    const auth = { Authorization: `Bearer ${admin.token}` };

    assert.equal((await request(app).delete(`/api/auth/users/${u.id}`).set(auth)).status, 200);
    const saved = await mongoose.connection.db.collection('users').findOne({ email: 'soft@test.com' });
    assert.equal(saved.deleted, true, 'still in the DB');
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${u.token}`)).status, 401);

    assert.equal((await request(app).put(`/api/auth/users/${u.id}/restore`).set(auth)).status, 200);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${u.token}`)).status, 200);
    assert.equal((await request(app).put(`/api/auth/users/${u.id}/restore`).set(auth)).status, 404, 'not deleted anymore');
  });
});

// Keep LAST: it blocks /login for this test file
describe('rate limit', () => {
  it('too many login attempts -> 429', async () => {
    let last;
    for (let i = 0; i < 25; i++) {
      last = await request(app).post('/api/auth/login').send({ email: 'x@test.com', password: 'nope12' });
    }
    assert.equal(last.status, 429);
  });
});
