// Shared constants and small validation helpers.
// One source of truth: models, controllers and routes all import from here.

const TICKET_STATUSES = ['non résolu', 'en cours', 'résolu'];
const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const USER_ROLES = ['user', 'admin', 'superadmin'];
const PRIORITY_WEIGHT = { urgent: 4, high: 3, normal: 2, low: 1 };

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// true only for a real 24-char hex MongoDB id (avoids CastError -> 500)
const isValidId = (id) => typeof id === 'string' && OBJECT_ID_RE.test(id);

// true for a non-empty string after trimming
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

module.exports = {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  USER_ROLES,
  PRIORITY_WEIGHT,
  EMAIL_RE,
  isValidId,
  isNonEmptyString,
};
