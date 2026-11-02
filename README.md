# Tiket Help — Support Ticket API

Backend of a support ticket application: users open tickets (with files), the support team
answers, assigns, follows and resolves them, and admins get a statistics dashboard.

**Stack:** Node.js · Express 5 · MongoDB (Mongoose 8) · JWT · bcrypt · Multer · Helmet

---

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [API conventions](#api-conventions)
- [API reference](#api-reference)
  - [Auth & account](#auth--account)
  - [Users (admin)](#users-admin)
  - [Tickets](#tickets)
  - [Activity logs (admin)](#activity-logs-admin)
  - [Statistics (admin)](#statistics-admin)
- [Security](#security)
- [Deployment checklist](#deployment-checklist)

---


## Business rules
All the rules the app follows (roles, tickets, closing, alerts, dashboard, logs) are written in
[BUSINESS_RULES.md](BUSINESS_RULES.md). Read it before changing the logic.

## Test data (development only)
`npm run seed` fills a **separate** database with 15 accounts, 60 tickets over the last 90 days,
conversations and activity logs (password `secret123` for every account). Set `SEED_MONGO_URI` in `.env`
(the database name must contain `dev`, `test` or `seed`), run the script, then start the API with
`MONGO_URI` pointing to the same database. It empties that database first and never touches `MONGO_URI`.

## Features

- **Accounts & roles** — `user`, `admin`, `superadmin`. New accounts must be activated by an admin.
- **Tickets** — subject, description, category, priority (`low` → `urgent`), status
  (`non résolu` → `en cours` → `résolu`), up to 5 files per ticket or reply.
- **Conversation** — the ticket owner and the support team reply on the ticket, with files.
- **Lists** — pagination, filters, full-text search and sorting on tickets and users.
- **Admin dashboard** — statistics calculated by MongoDB aggregation (totals, priorities,
  categories, resolution time, first response time, per-admin performance, timeline).
- **Audit trail** — every important action is written to the activity log.
- **Soft delete** — users are hidden, never lost (they can be restored).
- **Archive ("closed by support")** — resolved tickets leave the admin lists, but the owner always keeps them.

## Getting started

Requirements: **Node.js 20.10+** and a MongoDB database (local or MongoDB Atlas).

```bash
git clone https://github.com/yassine-YBG/help-tiket.git
cd help-tiket
npm install
cp .env.example .env      # then edit .env (at least MONGO_URI and JWT_SECRET)
npm run dev               # http://localhost:3000
```

Generate a strong `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**First superadmin:** register an account with `POST /api/auth/register`, then in MongoDB
set that user's `role` to `"superadmin"` and `activated` to `true`. From then on, the
superadmin activates accounts and gives roles through the API.

A ready-to-use **Postman collection** is in `postman/collections/tiket-help`. The **Login**
request saves the token automatically for all other requests.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | ✅ | — | MongoDB connection string |
| `JWT_SECRET` | ✅ | — | Secret used to sign tokens (long and random) |
| `PORT` | | `3000` | API port |
| `CORS_ORIGIN` | | all origins | Allowed frontend origins, comma separated (`http://localhost:5173`) |
| `STATS_TIMEZONE` | | `UTC` | Timezone for the stats timeline (`Africa/Tunis`) |
| `TRUST_PROXY` | | off | Set to `1` when hosted behind a proxy (Render, Railway, Nginx) |
| `UPLOAD_DIR` | | `uploads/tickets` | Folder where uploaded files are stored |
| `SEED_MONGO_URI` | | — | Dev only: separate database for `npm run seed` (name must contain `dev`, `test` or `seed`) |

The server refuses to start if `MONGO_URI` or `JWT_SECRET` is missing.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-restart on file changes (nodemon) |
| `npm start` | Start for production |
| `npm test` | Run the automated tests (~10 s) |
| `npm run seed` | Dev only: fill the `SEED_MONGO_URI` database with test data (see **Test data**) |

### Tests

`npm test` runs the test files in `tests/` with Node's built-in test runner and
[supertest](https://github.com/ladjs/supertest). Each test file starts its **own temporary
in-memory MongoDB** ([mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server))
and a temporary uploads folder, so **your real database and files are never touched**.
The first run downloads a MongoDB binary once (cached afterwards).

| File | Covers |
|---|---|
| `auth.test.js` | register, login, tokens, `/me`, change password, admin rules, rate limit |
| `users.test.js` | users list: pagination, search, filters, sort |
| `tickets.test.js` | create, read, reply, files, download rights, status, priority, archive |
| `ticketLists.test.js` | ticket lists: pagination, filters, search, sort, injection attempts |
| `stats.test.js` | dashboard statistics |
| `activityLogs.test.js` | activity log pagination, filters, dates, what admins may see |
| `releaseTickets.test.js` | open tickets go back to the team when support stops working |
| `app.test.js` | security headers, 404, invalid JSON |

## Project structure

```
app.js                  Express app: middleware, routes, error handler
server.js               Entry point: loads .env, connects MongoDB, starts the server
controllers/            Request handlers (auth, tickets, stats, activity logs)
middleware/             JWT check + roles, file upload, rate limiting
models/                 Mongoose schemas (User, Ticket, ActivityLog)
routes/                 URL → middleware → controller
utils/                  Validation, pagination, ticket filters, file cleanup, logging
tests/                  Automated tests
postman/                Postman collection
```

## API conventions

- **Base URL:** `http://localhost:3000/api`
- **Authentication:** send the token from login in every protected request:
  `Authorization: Bearer <token>`. Tokens last **1 day**.
- **Errors** always look like `{ "error": "message" }`.

| Status | Meaning |
|---|---|
| `400` | Invalid input (missing field, bad value, bad id, unknown filter) |
| `401` | No token, invalid/expired token, account disabled/deleted, password changed |
| `403` | Logged in but not allowed (wrong role, not your ticket) |
| `404` | Not found |
| `429` | Too many attempts (login/register/change password) — wait 15 minutes |
| `500` | Server error |

- **Paginated lists** accept `?page=1&limit=20` (limit max **100**) and return:

```json
{
  "tickets": [ ... ],
  "pagination": { "page": 1, "limit": 20, "total": 57, "totalPages": 3, "hasNextPage": true, "hasPrevPage": false }
}
```

- Filters must be single values: `?status[$ne]=x` or a repeated parameter returns `400`.

## API reference

Roles: 👤 any logged-in user · 🛠️ admin or superadmin · 👑 superadmin only

### Auth & account

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/auth/register` | public | Create an account (not activated yet) |
| POST | `/auth/login` | public | Get a token |
| GET | `/auth/me` | 👤 | Current user |
| PUT | `/auth/me/password` | 👤 | Change my password |

**POST `/auth/register`** — body `{ "username", "lastname", "email", "password" }`
(password ≥ 6 characters). → `201 { "message" }`. The account must be activated by an admin.
`400` missing/invalid field or email already registered.

**POST `/auth/login`** — body `{ "email", "password" }` →

```json
{ "token": "eyJ...", "user": { "id": "...", "username": "...", "lastname": "...", "email": "...", "role": "user" } }
```

`401` wrong email or password · `403` account not activated yet.

**GET `/auth/me`** → `{ "user": { "id", "userId", "username", "lastname", "email", "role", "createdAt" } }`.
Call it when the frontend starts, to know who is logged in.

**PUT `/auth/me/password`** — body `{ "currentPassword", "newPassword" }` →
`{ "message", "token" }`. **Use the new token**: all older tokens (other devices) stop working.
`401` wrong current password · `400` too short / same as current.

### Users (admin)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/auth/users` | 🛠️ | List users (paginated) |
| GET | `/auth/users/pending` | 🛠️ | Accounts waiting for activation |
| PUT | `/auth/users/:id/activation` | 🛠️ | Activate / deactivate — body `{ "activated": true }` |
| DELETE | `/auth/users/:id` | 🛠️ | Delete (soft: hidden + blocked, kept in DB) |
| PUT | `/auth/users/:id/restore` | 🛠️ | Restore a deleted user |
| PUT | `/auth/users/:id/role` | 👑 | Change role — body `{ "role": "admin" }` |

**Support account stops working → its open tickets go back to the team.** Deactivating, deleting or
demoting (to `user`) an admin / superadmin sets `handledBy: null` on their **open** tickets, so another
admin can take them (resolved tickets keep their handler for the history). The response includes
`ticketsReleased` (a number).

Rules: nobody can act on their own account · an admin can only manage accounts with role
`user` · a superadmin can manage everyone else.

**GET `/auth/users`** — returns `{ users, pagination, sort }`

| Query | Example | Description |
|---|---|---|
| `page`, `limit` | `?page=2&limit=10` | Pagination |
| `search` | `?search=ali` | In username, lastname or email |
| `role` | `?role=admin,superadmin` | One or several roles |
| `activated` | `?activated=false` | `true` or `false` |
| `deleted` | `?deleted=true` | `true` = only deleted accounts (to restore them); default: hidden |
| `sort` | `?sort=name` | `newest` (default), `oldest`, `name` |

### Tickets

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/tickets/create` | 👤 | Create a ticket (form-data, files allowed) |
| GET | `/tickets/my` | 👤 | My tickets (paginated) |
| GET | `/tickets` | 🛠️ | All tickets (paginated) |
| GET | `/tickets/summary` | 👤 | Counters for the menu badges (see **Alerts**; admins also get `pendingUsers`) |
| GET | `/tickets/:id` | owner or 🛠️ | One ticket with its conversation |
| POST | `/tickets/reply/:id` | owner or 🛠️ handler | Reply (form-data, files allowed) — not on a resolved ticket |
| PUT | `/tickets/seen/:id` | owner | The owner opened the ticket (clears "New answer") |
| PUT | `/tickets/priority/:id` | owner or 🛠️ handler | body `{ "priority": "high" }` (`urgent`: 🛠️ only) |
| PUT | `/tickets/assign/:id` | 🛠️ | Assign the ticket to myself (admins cannot take a superadmin's ticket) |
| PUT | `/tickets/status/:id` | 🛠️ handler | body `{ "status": "résolu" }` — only the admin handling the ticket |
| PUT | `/tickets/archive/:id` | handler or superadmin | Archive a **resolved** ticket (hidden from admin lists, owner still sees it) |
| PUT | `/tickets/unarchive/:id` | handler or superadmin | Bring an archived ticket back to the admin lists |
| GET | `/tickets/:ticketId/attachment/:type/:attachmentId/download` | owner or 🛠️ | Download a file |

**POST `/tickets/create`** — `multipart/form-data`:
`subject` (max 150 characters), `description` (max 5000), `category` (max 50) — all required,
`priority` (`low`, `normal` default, `high`, `urgent`),
`attachments` (files, max 5 × 10 MB: jpg, png, gif, pdf, doc, docx, txt, mp3, wav, mp4, mov).
→ `201 { "message", "ticketId", "attachmentsCount" }`. `400` missing or too long field, bad priority,
bad file type or size · `403` a normal user asked for `urgent`.

**Priority rule — `urgent` is decided by the support team:** a normal user can choose `low`,
`normal` or `high`. Only an admin / superadmin can set `urgent` (on creation or with
`PUT /tickets/priority/:id`). A user may keep or lower an urgent ticket, but never raise one
to urgent (`403`). This keeps "urgent" meaningful for sorting and statistics.

**Text limits** (counted after removing spaces at both ends): subject 150, category 50,
description 5000, reply message 5000 characters — longer values get `400` with the field name.

**POST `/tickets/reply/:id`** — `multipart/form-data` (or JSON): `message` (max 5000 characters)
and/or `attachments` (at least one). The reply is added to `messages` with the sender.
**A resolved ticket is closed:** replying to it gives `400` for everyone (owner and support).
The owner opens a new ticket; support can set the status back to `en cours` to reopen it first.

**Alerts — who must act next** (shown as badges and menu counters in the app):
- `awaitingSupport: true` — the owner wrote last (or nobody answered a new ticket yet): support must
  reply. Becomes `false` when support replies or the ticket is resolved. Admin filter:
  `GET /tickets?awaitingSupport=true` ("Needs reply").
- `supportUpdatedAt` — last time support replied or changed the status. `ownerSeenAt` — last time the
  owner opened the ticket (`PUT /tickets/seen/:id`, the owner only; a simple GET never changes data).
  The owner has a **new answer** when `supportUpdatedAt` is after `ownerSeenAt`.
- `GET /tickets/summary` → admins: `{ "needsReply", "needsReplyMine" }` (not archived, waiting for
  support; `Mine` = handled by me) · users: `{ "newAnswers" }`.
- Tickets created before this feature have no alert (fields empty).

**Status flow:** `non résolu` → `en cours` (when an admin assigns or changes it) → `résolu`.
Assigning a resolved ticket keeps it `résolu`. Setting `résolu` saves `resolvedAt`;
reopening clears it.

**One handler per ticket:** support (admin **and** superadmin) can reply to a ticket or change its
status **only when it is assigned to them** — `PUT /tickets/assign/:id` first (it also takes over a
ticket from another admin). Otherwise `403` "Assign this ticket to yourself…" or
"This ticket is handled by <name>. Take it over…". The owner can always reply to their open ticket.
The same rule applies to **priority** (`PUT /tickets/priority/:id`): support changes it only on a
ticket assigned to them; the owner keeps their own rules (never raise to `urgent`).

**A ticket held by a superadmin stays with them:** an admin calling `PUT /tickets/assign/:id` on it
gets `403` "…handled by <name> (superadmin). Admins cannot take it over". Another superadmin can.
Support sees the handler's `role` in tickets (users never see roles or emails).

**Archive ("closed by support")** — there is no delete for tickets: a user never loses one.
- `PUT /tickets/archive/:id` → `200 { "message", "archivedAt" }`. Only for a **resolved** ticket
  (`400` otherwise, or if already archived), by **the admin handling it or a superadmin** (`403` otherwise).
- The ticket disappears from `GET /tickets` (see `?archived=only`), but the owner still gets it in
  `GET /tickets/my` and `GET /tickets/:id`, with `"archived": true` (the app shows "Closed by support").
- Nobody can write in it (it is resolved). It comes back to the admin lists when an admin sets a
  status other than `résolu`, or with `PUT /tickets/unarchive/:id` (same rule as archive).
- Files are never removed.

**Download** — `:type` is `ticket` (files of the ticket) or `message` (files of a reply).
The file is sent with its original name.

**Privacy** — normal users only see **usernames** of the people in a ticket; admins also see emails.

**GET `/tickets`** and **GET `/tickets/my`** — return `{ tickets, pagination, sort }`

| Query | Example | Description |
|---|---|---|
| `page`, `limit` | `?page=1&limit=20` | Pagination |
| `status` | `?status=non résolu,en cours` | One or several |
| `priority` | `?priority=urgent,high` | One or several |
| `category` | `?category=youtube` | Exact name, any case |
| `search` | `?search=login` | Text in subject or description |
| `from`, `to` | `?from=2026-10-01&to=2026-10-31` | Creation date (the `to` day is included) |
| `sort` | `?sort=priority` | `newest`, `oldest`, `priority` (default: `newest` for `/tickets`, `priority` for `/my`) |
| `handledBy` | `?handledBy=none` | 🛠️ `/tickets` only: `me`, `none` or a user id |
| `createdBy` | `?createdBy=<userId>` | 🛠️ `/tickets` only |
| `archived` | `?archived=only` | 🛠️ `/tickets` only: archived tickets are hidden unless `only` or `include` |
| `awaitingSupport` | `?awaitingSupport=true` | 🛠️ `/tickets` only: tickets waiting for a support reply |

Example — open, unassigned tickets, most urgent first:
`GET /api/tickets?status=non résolu&handledBy=none&sort=priority`

### Activity logs (admin)

**GET `/activity-logs`** 🛠️ — newest first, returns `{ logs, pagination }`.
Filters: `user` (user id), `targetModel` (`User` or `Ticket`), `target` (id of the user/ticket),
`from` / `to` (action date, `2026-10-01`; the `to` day is included).
**Admins never see what a superadmin did**; the superadmin sees everything.

### Statistics (admin)

**GET `/stats`** 🛠️ — calculated by MongoDB with one aggregation query.

| Query | Example | Description |
|---|---|---|
| `from`, `to` | `?from=2026-10-01&to=2026-10-31` | Only tickets created in this range |
| `interval` | `?interval=week` | Timeline grouping: `day` (default), `week`, `month` |

```json
{
  "range": { "from": null, "to": null, "interval": "day", "timezone": "UTC" },
  "tickets": { "total": 10, "open": 6, "inProgress": 3, "resolved": 1, "unassigned": 5, "resolutionRate": 10 },
  "byStatus": { "non résolu": 6, "en cours": 3, "résolu": 1 },
  "byPriority": { "low": 1, "normal": 6, "high": 1, "urgent": 2 },
  "openByPriority": { "low": 1, "normal": 5, "high": 1, "urgent": 1 },
  "byCategory": [ { "category": "Logiciel", "count": 6 } ],
  "resolutionTime": { "count": 1, "averageHours": 5.2, "fastestHours": 5.2, "slowestHours": 5.2 },
  "firstResponseTime": { "count": 4, "averageHours": 31.5, "fastestHours": 0.4, "slowestHours": 96 },
  "byAdmin": [ { "adminId": "...", "username": "yassine", "email": "...", "handled": 3, "resolved": 1, "averageResolutionHours": 5.2 } ],  // superadmin only
  "timeline": [ { "period": "2026-10-30", "created": 2, "resolved": 1 } ],
  "users": { "total": 7, "pendingActivation": 0, "byRole": { "user": 4, "admin": 2, "superadmin": 1 } }
}
```

- **Resolution time** = `resolvedAt − createdAt` (only tickets resolved since `resolvedAt` exists).
- **First response time** = first reply written by someone other than the ticket creator.
- Times are in hours (1 decimal); `null` when there is no data.
- **`byAdmin` (team performance) is only sent to the superadmin**; admins get every other number.

## Security

| Risk | Protection |
|---|---|
| Password theft / guessing | bcrypt hashes; 20 login/register attempts per 15 min per IP |
| Account enumeration | Same error for unknown email and wrong password |
| Disabled, deleted or demoted accounts | Checked in the database on every request — applies immediately |
| Stolen token after password change | Token version: changing the password invalidates all older tokens |
| Reading other people's tickets/files | Ownership checks on read, reply, priority and download |
| NoSQL / regex injection | Query values must be plain text; search text is escaped |
| Dangerous uploads | Type whitelist, extension from the checked type, size/count limits, no public folder |
| Information leaks | No passwords/URIs in logs, no stack traces in responses, Helmet headers, relative file paths |

## Deployment checklist

- [ ] Long random `JWT_SECRET`
- [ ] `CORS_ORIGIN` set to the frontend URL
- [ ] `TRUST_PROXY=1` when behind a proxy
- [ ] MongoDB user limited to this database, strong password
- [ ] Persistent disk for `UPLOAD_DIR` (uploaded files)
- [ ] `npm test` passes
