// Shared constants and small validation helpers.
// One source of truth: models, controllers and routes all import from here.

const TICKET_STATUSES = ['non résolu', 'en cours', 'résolu'];
const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
// "urgent" is decided by the support team: normal users cannot set it
const SUPPORT_ONLY_PRIORITY = 'urgent';

// Maximum text lengths (characters, after trimming). Keeps requests and the
// database reasonable even when someone calls the API directly.
const TEXT_LIMITS = {
  subject: 150,
  category: 50,
  description: 5000,
  message: 5000,
};
const USER_ROLES = ['user', 'admin', 'superadmin'];
const PRIORITY_WEIGHT = { urgent: 4, high: 3, normal: 2, low: 1 };

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// true only for a real 24-char hex MongoDB id (avoids CastError -> 500)
const isValidId = (id) => typeof id === 'string' && OBJECT_ID_RE.test(id);

// true for a non-empty string after trimming
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

// Escape regex special characters so "a.b*" is searched literally
// (also blocks ReDoS: a user can't send a slow regex pattern).
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// { subject: 'abc', description: '...' } -> first error message, or null if all fit
const checkTextLimits = (fields) => {
  for (const [field, value] of Object.entries(fields)) {
    const max = TEXT_LIMITS[field];
    if (typeof value === 'string' && max && value.trim().length > max) {
      return `"${field}" must be at most ${max} characters`;
    }
  }
  return null;
};

module.exports = {
  SUPPORT_ONLY_PRIORITY,
  TEXT_LIMITS,
  checkTextLimits,
  escapeRegex,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  USER_ROLES,
  PRIORITY_WEIGHT,
  EMAIL_RE,
  isValidId,
  isNonEmptyString,
};
