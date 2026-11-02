// Development only: fill a TEST database with realistic data (users, tickets over
// the last 3 months, conversations, resolutions, activity logs) to try the app and
// see the dashboard charts.
//
//   1. in .env add a SEPARATE database, e.g.
//        SEED_MONGO_URI=mongodb://127.0.0.1:27017/tiket-help-dev
//   2. npm run seed
//   3. to use it, start the API with MONGO_URI set to that same address
//
// Safety: it never reads MONGO_URI, it refuses a database whose name does not
// contain "dev", "test" or "seed", and it is the same data every run (fixed random seed).
// It EMPTIES the users, tickets and activity logs of that database first.
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const ActivityLog = require('../models/ActivityLog');

const PASSWORD = 'secret123';
const DAYS = 90;
const TICKETS = 60;
const HOUR = 36e5;

// --- safety checks ---------------------------------------------------------
const uri = process.env.SEED_MONGO_URI;
if (!uri) {
  console.error('❌ Set SEED_MONGO_URI in .env (a separate database, e.g. mongodb://127.0.0.1:27017/tiket-help-dev)');
  process.exit(1);
}
const dbName = (() => {
  try {
    return new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).pathname.replace('/', '');
  } catch {
    return '';
  }
})();
if (!/(dev|test|seed)/i.test(dbName)) {
  console.error(`❌ Refusing to seed "${dbName || '(no database name)'}": the name must contain dev, test or seed.`);
  process.exit(1);
}
if (process.env.MONGO_URI && process.env.MONGO_URI === uri) {
  console.warn('⚠️  SEED_MONGO_URI is the same as MONGO_URI — make sure this is not your real data.');
}

// --- same "random" data every run --------------------------------------------
let state = 20261102;
const random = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (min, max) => min + random() * (max - min);

const CATEGORIES = ['YouTube', 'Spotify', 'Netflix', 'Account', 'Payment', 'Software', 'Other'];
const PRIORITIES = ['low', 'normal', 'normal', 'normal', 'high', 'high', 'urgent'];
const SUBJECTS = [
  'Cannot log in', 'Payment refused', 'Video does not load', 'App crashes on start',
  'Wrong invoice amount', 'Password reset link expired', 'Playlist disappeared',
  'Subscription not activated', 'Slow streaming', 'Export button does nothing',
];

async function main() {
  await mongoose.connect(uri);
  console.log(`🌱 Seeding "${dbName}"…`);
  await Promise.all([User.deleteMany({}), Ticket.deleteMany({}), ActivityLog.deleteMany({})]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const now = Date.now();
  const make = (username, lastname, email, role, extra = {}) =>
    User.create({ username, lastname, email, role, password: hash, activated: true, ...extra });

  const boss = await make('Sara', 'Boss', 'superadmin@seed.test', 'superadmin');
  const admins = [
    await make('Malek', 'Support', 'malek@seed.test', 'admin'),
    await make('Rami', 'Support', 'rami@seed.test', 'admin'),
  ];
  const support = [boss, ...admins];
  const users = [];
  for (let i = 1; i <= 10; i++) users.push(await make(`User${i}`, 'Client', `user${i}@seed.test`, 'user'));
  await make('Pending', 'One', 'pending1@seed.test', 'user', { activated: false });
  await make('Pending', 'Two', 'pending2@seed.test', 'user', { activated: false });

  const logs = [];
  const log = (user, action, target, targetModel, timestamp) =>
    logs.push({ user: user._id, action, target: String(target), targetModel, timestamp });

  const tickets = [];
  for (let i = 0; i < TICKETS; i++) {
    const owner = pick(users);
    const createdAt = new Date(now - between(0.1, DAYS) * 24 * HOUR);
    const age = (now - createdAt.getTime()) / HOUR; // hours since creation
    const _id = new mongoose.Types.ObjectId();
    const ticket = {
      _id,
      subject: `${pick(SUBJECTS)} #${i + 1}`,
      description: 'Created by the seed script to try the app.',
      category: pick(CATEGORIES),
      priority: pick(PRIORITIES),
      status: 'non résolu',
      createdBy: owner._id,
      createdAt,
      messages: [],
      attachments: [],
      awaitingSupport: true,
    };
    log(owner, `Created a ticket: ${ticket.subject} with 0 attachment(s)`, _id, 'Ticket', createdAt);

    // most tickets were picked up by support; the newest ones may still wait
    const roll = random();
    if (age > 2 && roll < 0.85) {
      const handler = pick(support);
      const firstReply = new Date(createdAt.getTime() + between(0.2, Math.min(age - 0.1, 30)) * HOUR);
      ticket.handledBy = handler._id;
      ticket.status = 'en cours';
      log(handler, 'Assigned self to ticket', _id, 'Ticket', firstReply);
      ticket.messages.push({ sender: handler._id, message: 'Thanks, we are looking into it.', attachments: [], sentAt: firstReply });
      ticket.awaitingSupport = false;
      ticket.supportUpdatedAt = firstReply;

      // the user sometimes answers back
      if (random() < 0.5) {
        const answer = new Date(firstReply.getTime() + between(0.1, 6) * HOUR);
        if (answer.getTime() < now) {
          ticket.messages.push({ sender: owner._id, message: 'Here are more details.', attachments: [], sentAt: answer });
          ticket.awaitingSupport = true;
        }
      }

      // most of the older tickets get resolved
      if (age > 24 && random() < 0.75) {
        const resolvedAt = new Date(firstReply.getTime() + between(1, Math.min(age - 1, 120)) * HOUR);
        if (resolvedAt.getTime() < now) {
          ticket.messages.push({ sender: handler._id, message: 'Fixed, please check.', attachments: [], sentAt: resolvedAt });
          ticket.status = 'résolu';
          ticket.resolvedAt = resolvedAt;
          ticket.awaitingSupport = false;
          ticket.supportUpdatedAt = resolvedAt;
          log(handler, 'Changed status from en cours to résolu', _id, 'Ticket', resolvedAt);
          // some resolved tickets are archived ("closed by support")
          if (random() < 0.3) {
            ticket.archived = true;
            ticket.archivedAt = new Date(resolvedAt.getTime() + HOUR);
            ticket.archivedBy = handler._id;
            log(handler, `Archived ticket: ${ticket.subject}`, _id, 'Ticket', ticket.archivedAt);
          }
        }
      }
    }
    tickets.push(ticket);
  }

  await Ticket.insertMany(tickets);
  await ActivityLog.insertMany(logs);

  const count = (s) => tickets.filter((t) => t.status === s).length;
  console.log(`✅ ${await User.countDocuments()} accounts, ${tickets.length} tickets ` +
    `(${count('non résolu')} open, ${count('en cours')} in progress, ${count('résolu')} resolved), ${logs.length} activity logs`);
  console.log(`   Log in with any of these (password "${PASSWORD}"):`);
  console.log('   superadmin@seed.test · malek@seed.test · rami@seed.test · user1@seed.test … user10@seed.test');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Seed failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
