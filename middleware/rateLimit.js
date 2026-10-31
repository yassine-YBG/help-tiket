const { rateLimit } = require('express-rate-limit');

// Protects /login and /register against password guessing and spam accounts.
// 20 requests per IP every 15 minutes.
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again in 15 minutes' },
});

// Change password: stops someone with a stolen token from guessing the
// current password. Separate counter from login/register.
exports.passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again in 15 minutes' },
});
