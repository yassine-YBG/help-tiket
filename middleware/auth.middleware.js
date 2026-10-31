const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ✅ Verify JWT token AND check the account is still valid in the database.
// This way a deactivated / deleted user, or a role change, takes effect
// immediately instead of after the token expires (1 day).
exports.verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const user = await User.findById(decoded.userId).select('role activated deleted tokenVersion');
    if (!user || user.deleted || !user.activated) {
      return res.status(401).json({ error: 'Account disabled or not found' });
    }

    // token created before the last password change -> log in again
    // (tokens from before this feature have no "tv" = version 0)
    if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({ error: 'Password changed, please log in again' });
    }

    // role comes from the database, not from the (possibly old) token
    req.user = { userId: user._id.toString(), role: user.role };
    next();
  } catch (err) {
    console.error('❌ verifyToken error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: insufficient permissions' });
    }
    next();
  };
};
