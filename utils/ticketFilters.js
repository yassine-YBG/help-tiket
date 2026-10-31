// Turns the URL query (?status=...&priority=...&search=...) into a MongoDB filter
// and a sort order for ticket lists.
//
// Used by GET /api/tickets (admin) and GET /api/tickets/my (user).
//
// Supported filters:
//   status     one or several, comma separated   ?status=non résolu,en cours
//   priority   one or several, comma separated   ?priority=urgent,high
//   category   exact name, not case-sensitive     ?category=youtube
//   search     text inside subject or description ?search=login
//   from / to  creation date (YYYY-MM-DD)         ?from=2026-10-01&to=2026-10-31
//   handledBy  admins only: me | none | <userId>  ?handledBy=none
//   createdBy  admins only: <userId>              ?createdBy=6a...
//   sort       newest | oldest | priority         ?sort=priority

const mongoose = require('mongoose');
const {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  PRIORITY_WEIGHT,
  isValidId,
  escapeRegex,
} = require('./validation');

const SORT_OPTIONS = ['newest', 'oldest', 'priority'];
const MAX_SEARCH_LENGTH = 100;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// "a, b ,c" -> ['a','b','c']
const splitList = (value) =>
  String(value).split(',').map((v) => v.trim()).filter(Boolean);

// Query values must be plain strings. Express turns ?status[]=x or ?status[$ne]=x
// into arrays/objects — we refuse those (protects against NoSQL injection).
const isPlainString = (value) => typeof value === 'string';

const parseDate = (value, endOfDay) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // "2026-10-31" as "to" means "until the end of that day"
  if (endOfDay && DATE_ONLY_RE.test(value)) date.setUTCHours(23, 59, 59, 999);
  return date;
};

/**
 * @param {object} query      req.query
 * @param {object} options
 * @param {object} options.user        req.user ({ userId, role })
 * @param {boolean} options.onlyMine   true for /my (forces createdBy = current user)
 * @param {string} options.defaultSort sort used when ?sort is not given
 * @returns {{ match, sort } | { error }}
 */
const buildTicketQuery = (query = {}, { user, onlyMine = false, defaultSort = 'newest' }) => {
  const isAdmin = user.role !== 'user';
  const match = { deleted: { $ne: true } };

  const allowed = ['status', 'priority', 'category', 'search', 'from', 'to', 'sort', 'page', 'limit'];
  if (isAdmin && !onlyMine) allowed.push('handledBy', 'createdBy');

  // Unknown or not-allowed filter -> clear 400 instead of being silently ignored
  for (const key of Object.keys(query)) {
    if (!allowed.includes(key)) return { error: `Unknown or not allowed filter: "${key}"` };
    if (!isPlainString(query[key])) return { error: `Filter "${key}" must be a single text value` };
  }

  if (onlyMine) {
    match.createdBy = new mongoose.Types.ObjectId(user.userId);
  }

  if (query.status !== undefined) {
    const statuses = splitList(query.status);
    const bad = statuses.find((s) => !TICKET_STATUSES.includes(s));
    if (!statuses.length || bad) {
      return { error: `Invalid status "${bad || ''}". Allowed: ${TICKET_STATUSES.join(', ')}` };
    }
    match.status = { $in: statuses };
  }

  if (query.priority !== undefined) {
    const priorities = splitList(query.priority);
    const bad = priorities.find((p) => !TICKET_PRIORITIES.includes(p));
    if (!priorities.length || bad) {
      return { error: `Invalid priority "${bad || ''}". Allowed: ${TICKET_PRIORITIES.join(', ')}` };
    }
    match.priority = { $in: priorities };
  }

  if (query.category !== undefined) {
    const category = query.category.trim();
    if (!category) return { error: '"category" cannot be empty' };
    match.category = { $regex: `^${escapeRegex(category)}$`, $options: 'i' };
  }

  if (query.search !== undefined) {
    const search = query.search.trim();
    if (!search) return { error: '"search" cannot be empty' };
    if (search.length > MAX_SEARCH_LENGTH) {
      return { error: `"search" must be at most ${MAX_SEARCH_LENGTH} characters` };
    }
    const regex = { $regex: escapeRegex(search), $options: 'i' };
    match.$or = [{ subject: regex }, { description: regex }];
  }

  if (query.from !== undefined || query.to !== undefined) {
    match.createdAt = {};
    if (query.from !== undefined) {
      const from = parseDate(query.from, false);
      if (!from) return { error: '"from" must be a date like 2026-10-01' };
      match.createdAt.$gte = from;
    }
    if (query.to !== undefined) {
      const to = parseDate(query.to, true);
      if (!to) return { error: '"to" must be a date like 2026-10-31' };
      match.createdAt.$lte = to;
    }
    if (match.createdAt.$gte && match.createdAt.$lte && match.createdAt.$gte > match.createdAt.$lte) {
      return { error: '"from" must be before "to"' };
    }
  }

  if (query.handledBy !== undefined) {
    if (query.handledBy === 'me') {
      match.handledBy = new mongoose.Types.ObjectId(user.userId);
    } else if (query.handledBy === 'none') {
      match.handledBy = null; // matches "not set" and "null"
    } else if (isValidId(query.handledBy)) {
      match.handledBy = new mongoose.Types.ObjectId(query.handledBy);
    } else {
      return { error: '"handledBy" must be "me", "none" or a user id' };
    }
  }

  if (query.createdBy !== undefined) {
    if (!isValidId(query.createdBy)) return { error: '"createdBy" must be a user id' };
    match.createdBy = new mongoose.Types.ObjectId(query.createdBy);
  }

  const sort = query.sort === undefined ? defaultSort : query.sort;
  if (!SORT_OPTIONS.includes(sort)) {
    return { error: `Invalid sort. Allowed: ${SORT_OPTIONS.join(', ')}` };
  }

  return { match, sort };
};

// MongoDB expression: 'urgent' -> 4, 'high' -> 3, 'normal' -> 2, 'low' -> 1
// Lets the database sort by priority (sorting the text would give the wrong order).
const PRIORITY_WEIGHT_EXPR = {
  $switch: {
    branches: Object.entries(PRIORITY_WEIGHT).map(([priority, weight]) => ({
      case: { $eq: ['$priority', priority] },
      then: weight,
    })),
    default: 0,
  },
};

// Aggregation stages for each sort. _id is the tie-breaker so pages never
// repeat or skip a ticket when two tickets have the same date.
const sortStages = (sort) => {
  if (sort === 'priority') {
    return [
      { $addFields: { _priorityWeight: PRIORITY_WEIGHT_EXPR } },
      { $sort: { _priorityWeight: -1, createdAt: -1, _id: -1 } },
      { $unset: '_priorityWeight' },
    ];
  }
  if (sort === 'oldest') return [{ $sort: { createdAt: 1, _id: 1 } }];
  return [{ $sort: { createdAt: -1, _id: -1 } }];
};

module.exports = { buildTicketQuery, sortStages, SORT_OPTIONS };
