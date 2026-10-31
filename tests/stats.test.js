// GET /api/stats (MongoDB aggregation)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, teardown, createUser } = require('./helpers');

let app;
let admin;
let user;
const stats = (qs = '', u = admin) => request(app).get(`/api/stats${qs}`).set('Authorization', `Bearer ${u.token}`);

const HOUR = 36e5;

before(async () => {
  app = await setup();
  const Ticket = require('../models/Ticket');
  await createUser({ role: 'superadmin' });
  admin = await createUser({ role: 'admin', username: 'admin1' });
  user = await createUser();
  await createUser({ activated: false });

  const day = new Date(Date.UTC(2026, 9, 1, 8)); // Oct 1 2026, 08:00 UTC
  await Ticket.insertMany([
    // resolved in 2h, admin answered after 1h
    {
      subject: 'a', description: 'd', category: 'YouTube', priority: 'urgent', status: 'résolu',
      createdBy: user.user._id, handledBy: admin.user._id, createdAt: day,
      resolvedAt: new Date(day.getTime() + 2 * HOUR),
      messages: [
        { sender: user.user._id, message: 'more info', sentAt: new Date(day.getTime() + 0.5 * HOUR) },
        { sender: admin.user._id, message: 'fixed', sentAt: new Date(day.getTime() + 1 * HOUR) },
      ],
    },
    { subject: 'b', description: 'd', category: 'Netflix', priority: 'urgent', status: 'en cours', createdBy: user.user._id, handledBy: admin.user._id, createdAt: day },
    { subject: 'c', description: 'd', category: 'Netflix', priority: 'low', status: 'non résolu', createdBy: user.user._id, createdAt: new Date(day.getTime() + 24 * HOUR) },
    { subject: 'd', description: 'd', category: 'Netflix', priority: 'normal', status: 'non résolu', createdBy: user.user._id, createdAt: new Date(day.getTime() + 24 * HOUR) },
    { subject: 'deleted', description: 'd', category: 'X', priority: 'high', status: 'non résolu', createdBy: user.user._id, createdAt: day, deleted: true },
  ]);
});
after(teardown);

describe('GET /api/stats', () => {
  it('totals (deleted tickets ignored)', async () => {
    const res = await stats();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.tickets, { total: 4, open: 2, inProgress: 1, resolved: 1, unassigned: 2, resolutionRate: 25 });
  });

  it('by priority, open by priority, by category', async () => {
    const { body } = await stats();
    assert.deepEqual(body.byPriority, { low: 1, normal: 1, high: 0, urgent: 2 });
    assert.deepEqual(body.openByPriority, { low: 1, normal: 1, high: 0, urgent: 1 });
    assert.deepEqual(body.byCategory, [{ category: 'Netflix', count: 3 }, { category: 'YouTube', count: 1 }]);
  });

  it('resolution time and first response time (in hours)', async () => {
    const { body } = await stats();
    assert.deepEqual(body.resolutionTime, { count: 1, averageHours: 2, fastestHours: 2, slowestHours: 2 });
    // the creator's own message does not count as a "response"
    assert.deepEqual(body.firstResponseTime, { count: 1, averageHours: 1, fastestHours: 1, slowestHours: 1 });
  });

  it('per admin', async () => {
    const { body } = await stats();
    assert.equal(body.byAdmin.length, 1);
    assert.equal(body.byAdmin[0].username, 'admin1');
    assert.equal(body.byAdmin[0].handled, 2);
    assert.equal(body.byAdmin[0].resolved, 1);
    assert.equal(body.byAdmin[0].averageResolutionHours, 2);
  });

  it('timeline by day, week, month', async () => {
    assert.deepEqual((await stats()).body.timeline, [
      { period: '2026-10-01', created: 2, resolved: 1 },
      { period: '2026-10-02', created: 2, resolved: 0 },
    ]);
    assert.deepEqual((await stats('?interval=month')).body.timeline, [{ period: '2026-10', created: 4, resolved: 1 }]);
    assert.match((await stats('?interval=week')).body.timeline[0].period, /^\d{4}-W\d{2}$/);
  });

  it('users summary (deleted users ignored)', async () => {
    const { body } = await stats();
    assert.deepEqual(body.users, { total: 4, pendingActivation: 1, byRole: { user: 2, admin: 1, superadmin: 1 } });
  });

  it('date range', async () => {
    assert.equal((await stats('?from=2026-10-02&to=2026-10-02')).body.tickets.total, 2);
    const future = (await stats('?from=2030-01-01')).body;
    assert.equal(future.tickets.total, 0);
    assert.equal(future.resolutionTime.averageHours, null);
  });

  it('bad options -> 400, normal user -> 403', async () => {
    for (const qs of ['?interval=year', '?from=nope', '?x=1', '?from=2026-12-01&to=2026-01-01']) {
      assert.equal((await stats(qs)).status, 400, qs);
    }
    assert.equal((await stats('', user)).status, 403);
  });
});
