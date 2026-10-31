// Generic pagination helpers — reusable for any list (tickets, users, activity logs...).
//
//   ?page=2&limit=20   -> skip the first 20 items, return the next 20
//
// Defaults: page 1, limit 20. Max limit 100 (stops someone asking for 1 000 000 rows).

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Positive whole number written only with digits ("2" ok, "2.5" / "-1" / "abc" not ok)
const POSITIVE_INT_RE = /^[1-9]\d*$/;

// Reads page & limit from req.query.
// Returns { page, limit, skip } or { error } when a value is invalid.
const parsePagination = (query = {}) => {
  const { page = '1', limit = String(DEFAULT_LIMIT) } = query;

  if (!POSITIVE_INT_RE.test(String(page))) {
    return { error: '"page" must be a whole number greater than 0' };
  }
  if (!POSITIVE_INT_RE.test(String(limit)) || Number(limit) > MAX_LIMIT) {
    return { error: `"limit" must be a whole number between 1 and ${MAX_LIMIT}` };
  }

  const pageNum = Number(page);
  const limitNum = Number(limit);
  return { page: pageNum, limit: limitNum, skip: (pageNum - 1) * limitNum };
};

// Builds the "pagination" block sent back to the client
const buildPaginationInfo = ({ page, limit, total }) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

module.exports = { parsePagination, buildPaginationInfo, DEFAULT_LIMIT, MAX_LIMIT };
