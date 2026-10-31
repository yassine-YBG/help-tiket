// Entry point: load .env, check the config, connect to MongoDB, then start the API.
// The Express app itself lives in app.js.
require('dotenv').config();
const mongoose = require('mongoose');

// Stop early with a clear message if the config is incomplete
const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`🚨 Missing in .env: ${missing.join(', ')}`);
  process.exit(1);
}

const app = require('./app');

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
