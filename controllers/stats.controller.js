// Admin dashboard statistics — GET /api/stats
//
// Everything is calculated INSIDE MongoDB with the aggregation pipeline:
// MongoDB groups and counts the tickets itself and only sends back the
// small results (not thousands of tickets). One query with $facet runs
// several groupings ("facets") over the same tickets at once.
//
// Query options (all optional):
//   from, to   only tickets created in this date range   ?from=2026-10-01&to=2026-10-31
//   interval   how to group the timeline: day | week | month (default day)

const Ticket = require('../models/Ticket');
const User = require('../models/User');
const { TICKET_STATUSES, TICKET_PRIORITIES } = require('../utils/validation');

const INTERVAL_FORMATS = { day: '%Y-%m-%d', week: '%G-W%V', month: '%Y-%m' };
const ALLOWED_QUERY = ['from', 'to', 'interval'];
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOP_CATEGORIES = 10;

// Timezone used to decide "which day" a ticket belongs to (env STATS_TIMEZONE, e.g. Africa/Tunis)
const TIMEZONE = (() => {
  const tz = process.env.STATS_TIMEZONE || 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    console.warn(`⚠️ Invalid STATS_TIMEZONE "${tz}", using UTC`);
    return 'UTC';
  }
})();

const msToHours = (ms) => (ms == null ? null : Math.round((ms / 36e5) * 10) / 10);

// [{ _id: 'urgent', count: 3 }] -> { low: 0, normal: 0, high: 0, urgent: 3 }
const toCountMap = (rows, keys) => {
  const map = Object.fromEntries(keys.map((k) => [k, 0]));
  rows.forEach((r) => { if (r._id in map) map[r._id] = r.count; });
  return map;
};

const durationStats = (row) => ({
  count: row ? row.count : 0,
  averageHours: msToHours(row && row.avg),
  fastestHours: msToHours(row && row.min),
  slowestHours: msToHours(row && row.max),
});

const parseRange = (query) => {
  for (const key of Object.keys(query)) {
    if (!ALLOWED_QUERY.includes(key)) return { error: `Unknown option: "${key}"` };
    if (typeof query[key] !== 'string') return { error: `Option "${key}" must be a single text value` };
  }
  const interval = query.interval || 'day';
  if (!INTERVAL_FORMATS[interval]) return { error: 'interval must be day, week or month' };

  const createdAt = {};
  if (query.from !== undefined) {
    const from = new Date(query.from);
    if (Number.isNaN(from.getTime())) return { error: '"from" must be a date like 2026-10-01' };
    createdAt.$gte = from;
  }
  if (query.to !== undefined) {
    const to = new Date(query.to);
    if (Number.isNaN(to.getTime())) return { error: '"to" must be a date like 2026-10-31' };
    if (DATE_ONLY_RE.test(query.to)) to.setUTCHours(23, 59, 59, 999); // whole last day
    createdAt.$lte = to;
  }
  if (createdAt.$gte && createdAt.$lte && createdAt.$gte > createdAt.$lte) {
    return { error: '"from" must be before "to"' };
  }
  return { interval, createdAt };
};

exports.getStats = async (req, res) => {
  const range = parseRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });

  const match = { deleted: { $ne: true } };
  if (Object.keys(range.createdAt).length) match.createdAt = range.createdAt;

  // time between two dates, in milliseconds
  const resolutionMs = { $subtract: ['$resolvedAt', '$createdAt'] };

  try {
    const [ticketStats, userStats] = await Promise.all([
      Ticket.aggregate([
        // 1. keep only the tickets we want to count
        { $match: match },
        // 2. first reply written by someone OTHER than the ticket creator (= support answer)
        {
          $addFields: {
            firstResponseAt: {
              $min: {
                $map: {
                  input: {
                    $filter: {
                      input: { $ifNull: ['$messages', []] },
                      as: 'm',
                      cond: { $ne: ['$$m.sender', '$createdBy'] },
                    },
                  },
                  as: 'm',
                  in: '$$m.sentAt',
                },
              },
            },
          },
        },
        // 3. several groupings on the same tickets, in one query
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  unassigned: { $sum: { $cond: [{ $ifNull: ['$handledBy', false] }, 0, 1] } },
                },
              },
            ],
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
            openByPriority: [
              { $match: { status: { $ne: 'résolu' } } },
              { $group: { _id: '$priority', count: { $sum: 1 } } },
            ],
            byCategory: [
              { $group: { _id: '$category', count: { $sum: 1 } } },
              { $sort: { count: -1, _id: 1 } },
              { $limit: TOP_CATEGORIES },
            ],
            byAdmin: [
              { $match: { handledBy: { $ne: null } } },
              {
                $group: {
                  _id: '$handledBy',
                  handled: { $sum: 1 },
                  resolved: { $sum: { $cond: [{ $eq: ['$status', 'résolu'] }, 1, 0] } },
                  avgResolutionMs: {
                    $avg: { $cond: [{ $ifNull: ['$resolvedAt', false] }, resolutionMs, null] },
                  },
                },
              },
              { $sort: { handled: -1 } },
            ],
            resolution: [
              { $match: { status: 'résolu', resolvedAt: { $ne: null } } },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  avg: { $avg: resolutionMs },
                  min: { $min: resolutionMs },
                  max: { $max: resolutionMs },
                },
              },
            ],
            firstResponse: [
              { $match: { firstResponseAt: { $ne: null } } },
              { $project: { ms: { $subtract: ['$firstResponseAt', '$createdAt'] } } },
              { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: '$ms' }, min: { $min: '$ms' }, max: { $max: '$ms' } } },
            ],
            timeline: [
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: INTERVAL_FORMATS[range.interval],
                      date: '$createdAt',
                      timezone: TIMEZONE,
                    },
                  },
                  created: { $sum: 1 },
                  resolved: { $sum: { $cond: [{ $eq: ['$status', 'résolu'] }, 1, 0] } },
                },
              },
              { $sort: { _id: 1 } },
            ],
          },
        },
      ]),
      User.aggregate([
        { $match: { deleted: { $ne: true } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            pendingActivation: { $sum: { $cond: [{ $eq: ['$activated', false] }, 1, 0] } },
            users: { $sum: { $cond: [{ $eq: ['$role', 'user'] }, 1, 0] } },
            admins: { $sum: { $cond: [{ $eq: ['$role', 'admin'] }, 1, 0] } },
            superadmins: { $sum: { $cond: [{ $eq: ['$role', 'superadmin'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const t = ticketStats[0];
    const totals = t.totals[0] || { total: 0, unassigned: 0 };
    const byStatus = toCountMap(t.byStatus, TICKET_STATUSES);

    // add admin names to the "byAdmin" list
    const adminIds = t.byAdmin.map((a) => a._id);
    const admins = await User.find({ _id: { $in: adminIds } }, 'username email role');
    const adminById = new Map(admins.map((a) => [a._id.toString(), a]));

    const u = userStats[0] || { total: 0, pendingActivation: 0, users: 0, admins: 0, superadmins: 0 };

    // Team performance (each admin's numbers) is for the superadmin only
    const byAdmin = req.user.role === 'superadmin'
      ? t.byAdmin.map((a) => {
          const admin = adminById.get(a._id.toString());
          return {
            adminId: a._id,
            username: admin ? admin.username : '(deleted user)',
            email: admin ? admin.email : null,
            handled: a.handled,
            resolved: a.resolved,
            averageResolutionHours: msToHours(a.avgResolutionMs),
          };
        })
      : undefined;

    return res.status(200).json({
      range: {
        from: range.createdAt.$gte || null,
        to: range.createdAt.$lte || null,
        interval: range.interval,
        timezone: TIMEZONE,
      },
      tickets: {
        total: totals.total,
        open: byStatus['non résolu'],
        inProgress: byStatus['en cours'],
        resolved: byStatus['résolu'],
        unassigned: totals.unassigned,
        resolutionRate: totals.total ? Math.round((byStatus['résolu'] / totals.total) * 1000) / 10 : 0,
      },
      byStatus,
      byPriority: toCountMap(t.byPriority, TICKET_PRIORITIES),
      openByPriority: toCountMap(t.openByPriority, TICKET_PRIORITIES),
      byCategory: t.byCategory.map((c) => ({ category: c._id, count: c.count })),
      resolutionTime: durationStats(t.resolution[0]),
      firstResponseTime: durationStats(t.firstResponse[0]),
      ...(byAdmin ? { byAdmin } : {}),
      timeline: t.timeline.map((p) => ({ period: p._id, created: p.created, resolved: p.resolved })),
      users: {
        total: u.total,
        pendingActivation: u.pendingActivation,
        byRole: { user: u.users, admin: u.admins, superadmin: u.superadmins },
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};
