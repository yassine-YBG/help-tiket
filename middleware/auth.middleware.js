const jwt = require('jsonwebtoken');

// ✅ Verify JWT token
exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Check if Bearer token exists
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // now req.user = { userId, role }
    next(); // ✅ go to next middleware or controller
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
exports.requireRole = (roles) => { 
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: insufficient permissions' });
    }
    next();
  };
};