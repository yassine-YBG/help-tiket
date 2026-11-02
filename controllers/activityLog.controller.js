const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User');
const { parsePagination, buildPaginationInfo } = require('../utils/pagination');
const { isValidId } = require('../utils/validation');

const TARGET_MODELS = ['User', 'Ticket'];
const ALLOWED_FILTERS = ['page', 'limit', 'user', 'targetModel', 'target', 'from', 'to'];
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// "2026-10-31" as "to" means until the end of that day
const parseDate = (value, endOfDay) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && DATE_ONLY_RE.test(value)) date.setUTCHours(23, 59, 59, 999);
  return date;
};

// GET /api/activity-logs?page=1&limit=20&user=<userId>&targetModel=Ticket&target=<id>&from=2026-10-01&to=2026-10-31
// Newest first. Admin and superadmin only (checked in the route).
// Admins never see what a superadmin did; the superadmin sees everything.
exports.getActivityLogs = async (req, res) => {
  const pagination = parsePagination(req.query);
  if (pagination.error) return res.status(400).json({ error: pagination.error });

  const filter = {};
  for (const key of Object.keys(req.query)) {
    if (!ALLOWED_FILTERS.includes(key)) {
      return res.status(400).json({ error: `Unknown filter: "${key}"` });
    }
    if (typeof req.query[key] !== 'string') {
      return res.status(400).json({ error: `Filter "${key}" must be a single text value` });
    }
  }

  const { user, targetModel, target, from, to } = req.query;
  if (user !== undefined) {
    if (!isValidId(user)) return res.status(400).json({ error: '"user" must be a user id' });
    filter.user = { $eq: user };
  }
  if (from !== undefined || to !== undefined) {
    filter.timestamp = {};
    if (from !== undefined) {
      const date = parseDate(from, false);
      if (!date) return res.status(400).json({ error: '"from" must be a date like 2026-10-01' });
      filter.timestamp.$gte = date;
    }
    if (to !== undefined) {
      const date = parseDate(to, true);
      if (!date) return res.status(400).json({ error: '"to" must be a date like 2026-10-31' });
      filter.timestamp.$lte = date;
    }
    if (filter.timestamp.$gte && filter.timestamp.$lte && filter.timestamp.$gte > filter.timestamp.$lte) {
      return res.status(400).json({ error: '"from" must be before "to"' });
    }
  }
  if (targetModel !== undefined) {
    if (!TARGET_MODELS.includes(targetModel)) {
      return res.status(400).json({ error: `"targetModel" must be ${TARGET_MODELS.join(' or ')}` });
    }
    filter.targetModel = targetModel;
  }
  if (target !== undefined) {
    if (!isValidId(target)) return res.status(400).json({ error: '"target" must be an id' });
    filter.target = target;
  }

  try {
    if (req.user.role !== 'superadmin') {
      const superadminIds = await User.find({ role: 'superadmin' }).distinct('_id');
      filter.user = { ...(filter.user || {}), $nin: superadminIds };
    }

    const [logs, total] = await Promise.all([
      ActivityLog.find(filter)
        .populate('user', 'username email role')
        .sort({ timestamp: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      ActivityLog.countDocuments(filter),
    ]);

    return res.status(200).json({
      logs,
      pagination: buildPaginationInfo({ page: pagination.page, limit: pagination.limit, total }),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};
