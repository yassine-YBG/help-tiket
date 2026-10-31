// General app behaviour: security headers, 404, bad JSON.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, teardown } = require('./helpers');

let app;
before(async () => { app = await setup(); });
after(teardown);

describe('app', () => {
  it('security headers (helmet): no X-Powered-By, nosniff', async () => {
    const res = await request(app).get('/');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('unknown route -> JSON 404', async () => {
    const res = await request(app).get('/api/nothing');
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });

  it('invalid JSON -> 400 without a stack trace', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json');
    assert.equal(res.status, 400);
    assert.ok(!JSON.stringify(res.body).includes('at '));
  });
});
