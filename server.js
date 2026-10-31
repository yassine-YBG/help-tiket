require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');

// Stop early with a clear message if the config is incomplete
const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`🚨 Missing in .env: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();

// When deployed behind a proxy (Render, Railway, Nginx...), set TRUST_PROXY=1 in .env
// so the rate limiter sees each visitor's real IP instead of the proxy's IP.
// Leave it empty on localhost.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}

// Middleware
// helmet: secure HTTP headers (hides "X-Powered-By: Express", adds nosniff, etc.)
// crossOriginResourcePolicy "cross-origin" so a frontend on another port/domain
// can still display downloaded files (images, PDFs).
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS_ORIGIN (optional) = comma separated list, e.g. http://localhost:5173
// If it's not set, every origin is allowed (same as before).
const corsOptions = process.env.CORS_ORIGIN
  ? { origin: process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) }
  : undefined;
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// Test route
app.get('/', (req, res) => {
  res.send('🚀 Ticket App Backend Running');
});

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/tickets', require('./routes/ticket.routes'));
app.use('/api/activity-logs', require('./routes/activityLogRoutes'));
app.use('/api/stats', require('./routes/stats.routes'));

// Unknown route -> JSON 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Central error handler (upload errors, bad JSON, unexpected errors)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // e.g. LIMIT_FILE_SIZE (> 10MB), LIMIT_UNEXPECTED_FILE (> 5 files / wrong field name)
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err.status && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('❌ Unhandled error:', err);
  return res.status(500).json({ error: 'Server error' });
});

// Connect to MongoDB first, then start the server
// (the URI is never printed: it contains the DB password)
const PORT = process.env.PORT || 3000;
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB error:', err.message);
    process.exit(1);
  });

module.exports = app;
