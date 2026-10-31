const ActivityLog = require('../models/ActivityLog');
const { parsePagination, buildPaginationInfo } = require('../utils/pagination');
const { isValidId } = require('../utils/validation');

const TARGET_MODELS = ['User', 'Ticket'];
const ALLOWED_FILTERS = ['page', 'limit', 'user', 'targetModel', 'target'];

// GET /api/activity-logs?page=1&limit=20&user=<userId>&targetModel=Ticket&target=<id>
// Newest first. Admin and superadmin only (checked in the route).
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

  const { user, targetModel, target } = req.query;
  if (user !== undefined) {
    if (!isValidId(user)) return res.status(400).json({ error: '"user" must be a user id' });
    filter.user = user;
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
