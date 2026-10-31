// Shared test setup.
//
// Every test file gets its OWN temporary MongoDB (in memory, deleted at the end)
// and its OWN temporary uploads folder — your real database and files are never touched.
const os = require('os');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

const PASSWORD = 'secret123';

let mongod;
let uploadDir;
let User;

// Start the in-memory DB and load the app (env must be set BEFORE requiring the app)
async function setup() {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiket-help-test-'));
  process.env.JWT_SECRET = 'test_secret_only_for_tests';
  process.env.UPLOAD_DIR = uploadDir;
  process.env.NODE_ENV = 'test';

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const app = require('../app');
  User = require('../models/User');
  return app;
}

async function teardown() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  if (uploadDir) fs.rmSync(uploadDir, { recursive: true, force: true });
}

// Empty every collection (used between groups of tests)
async function resetDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

let counter = 0;

// Create a user directly in the DB and return { user, token } — no HTTP login needed
async function createUser({ role = 'user', activated = true, deleted = false, username, email } = {}) {
  counter += 1;
  const user = await User.create({
    username: username || `${role}${counter}`,
    lastname: 'Test',
    email: email || `${role}${counter}@test.com`,
    password: await bcrypt.hash(PASSWORD, 4), // low cost = fast tests
    role,
    activated,
    deleted,
  });
  const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
  return { user, token, id: user._id.toString() };
}

// Number of files in the temporary uploads folder
const countUploads = () => fs.readdirSync(uploadDir).length;

// Small wait (file deletion happens in the background)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { setup, teardown, resetDb, createUser, countUploads, wait, PASSWORD };
