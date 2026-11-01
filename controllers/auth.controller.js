const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const logActivity = require('../utils/logActivity');
const {
  USER_ROLES,
  EMAIL_RE,
  isValidId,
  isNonEmptyString,
  escapeRegex,
} = require('../utils/validation');
const { parsePagination, buildPaginationInfo } = require('../utils/pagination');
const { releaseOpenTickets } = require('../utils/releaseTickets');

const MIN_PASSWORD_LENGTH = 6;
const NOT_DELETED = { deleted: { $ne: true } }; // also matches old docs without the field

const USER_LIST_FIELDS = 'userId username lastname email role activated deleted createdAt';
const USER_LIST_FILTERS = ['page', 'limit', 'search', 'role', 'activated', 'deleted', 'sort'];
const USER_SORTS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  name: { username: 1, lastname: 1, _id: 1 },
};
const MAX_SEARCH_LENGTH = 100;

// Shared rule for every "admin acts on another user" action:
// - nobody can act on their own account (no self-delete / self-deactivate / self-demote)
// - an admin can only act on accounts with role "user"
// - a superadmin can act on anyone else
// Returns an error message, or null if allowed.
const checkCanManage = (requester, target) => {
  if (target._id.equals(requester.userId)) {
    return 'You cannot perform this action on your own account';
  }
  if (requester.role === 'admin' && target.role !== 'user') {
    return 'Admins can only manage users with role "user"';
  }
  return null;
};

// One place to create tokens (login + change password)
// "tv" = token version: must match user.tokenVersion (see auth.middleware.js)
const signToken = (user) =>
  jwt.sign(
    { userId: user._id, role: user.role, tv: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

// Public profile sent to the frontend (never the password hash)
const toPublicUser = (user) => ({
  id: user._id,
  userId: user.userId,
  username: user.username,
  lastname: user.lastname,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
});

// Register a new user
exports.register = async (req, res) => {
  const { username, lastname, email, password } = req.body || {};

  if (![username, lastname, email, password].every(isNonEmptyString)) {
    return res.status(400).json({ error: 'username, lastname, email and password are required' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    // Check if email already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user (role is never taken from the request body)
    const newUser = new User({
      username,
      lastname,
      email: normalizedEmail,
      password: hashedPassword,
      activated: false, // user must be activated by an admin / superadmin
    });

    await newUser.save();

    return res.status(201).json({ message: 'User registered. Awaiting activation by superadmin.' });
  } catch (err) {
    // two requests with the same email at the same moment
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Login
exports.login = async (req, res) => {
  const { email, password } = req.body || {};

  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });

    // Same message for "no user", "deleted user" and "wrong password":
    // an attacker can't find out which emails exist.
    if (!user || user.deleted) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Checked AFTER the password, so this message only goes to the real owner
    if (!user.activated) {
      return res.status(403).json({ error: 'Account is not activated' });
    }

    if (!process.env.JWT_SECRET) {
      console.error('🚨 Missing JWT_SECRET in .env!');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const token = signToken(user);

    return res.status(200).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        lastname: user.lastname,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('❌ Login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Who am I? The frontend calls this after a page reload to know
// which user is logged in (and their role) from the saved token.
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ user: toPublicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Change my password. Other sessions (old tokens) are logged out;
// this session gets a fresh token so the user stays logged in.
exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!isNonEmptyString(currentPassword) || !isNonEmptyString(newPassword)) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'The new password must be different from the current one' });
  }

  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    user.tokenVersion = (user.tokenVersion || 0) + 1; // every older token is now refused
    await user.save();

    await logActivity({
      user: user._id,
      action: 'Changed own password',
      target: user._id,
      targetModel: 'User'
    });

    return res.status(200).json({ message: 'Password changed successfully', token: signToken(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Get all users (admin and superadmin)
// GET /api/auth/users?page=1&limit=20&search=ali&role=admin,user&activated=true&sort=name
// Same response shape as the ticket lists: { users, pagination, sort }
exports.getUsers = async (req, res) => {
  const pagination = parsePagination(req.query);
  if (pagination.error) return res.status(400).json({ error: pagination.error });

  for (const key of Object.keys(req.query)) {
    if (!USER_LIST_FILTERS.includes(key)) {
      return res.status(400).json({ error: `Unknown filter: "${key}"` });
    }
    if (typeof req.query[key] !== 'string') {
      return res.status(400).json({ error: `Filter "${key}" must be a single text value` });
    }
  }

  const { search, role, activated, deleted, sort = 'newest' } = req.query;

  // ?deleted=true -> only deleted accounts (to restore them); default: only existing ones
  if (deleted !== undefined && deleted !== 'true' && deleted !== 'false') {
    return res.status(400).json({ error: '"deleted" must be true or false' });
  }
  const filter = deleted === 'true' ? { deleted: true } : { ...NOT_DELETED };

  if (search !== undefined) {
    const text = search.trim();
    if (!text) return res.status(400).json({ error: '"search" cannot be empty' });
    if (text.length > MAX_SEARCH_LENGTH) {
      return res.status(400).json({ error: `"search" must be at most ${MAX_SEARCH_LENGTH} characters` });
    }
    const regex = { $regex: escapeRegex(text), $options: 'i' };
    filter.$or = [{ username: regex }, { lastname: regex }, { email: regex }];
  }

  if (role !== undefined) {
    const roles = role.split(',').map((r) => r.trim()).filter(Boolean);
    const bad = roles.find((r) => !USER_ROLES.includes(r));
    if (!roles.length || bad) {
      return res.status(400).json({ error: `Invalid role "${bad || ''}". Allowed: ${USER_ROLES.join(', ')}` });
    }
    filter.role = { $in: roles };
  }

  if (activated !== undefined) {
    if (activated !== 'true' && activated !== 'false') {
      return res.status(400).json({ error: '"activated" must be true or false' });
    }
    filter.activated = activated === 'true';
  }

  if (!USER_SORTS[sort]) {
    return res.status(400).json({ error: `Invalid sort. Allowed: ${Object.keys(USER_SORTS).join(', ')}` });
  }

  try {
    const [users, total] = await Promise.all([
      User.find(filter, USER_LIST_FIELDS)
        .sort(USER_SORTS[sort])
        .skip(pagination.skip)
        .limit(pagination.limit),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      users,
      pagination: buildPaginationInfo({ page: pagination.page, limit: pagination.limit, total }),
      sort,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Activate or deactivate user
exports.toggleActivation = async (req, res) => {
  try {
    const { id } = req.params;
    const { activated } = req.body || {};

    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid user id' });
    if (typeof activated !== 'boolean') {
      return res.status(400).json({ error: '"activated" must be true or false' });
    }

    const user = await User.findOne({ _id: id, ...NOT_DELETED });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const denied = checkCanManage(req.user, user);
    if (denied) return res.status(403).json({ error: denied });

    user.activated = activated;
    await user.save();
    const ticketsReleased = activated ? 0 : await releaseOpenTickets(user);
    await logActivity({
      user: req.user.userId,
      action: `User ${activated ? 'activated' : 'deactivated'}: ${user.email}${ticketsReleased ? ` (${ticketsReleased} open ticket(s) released)` : ''}`,
      target: user._id,
      targetModel: 'User'
    });

    return res.status(200).json({
      message: `User ${activated ? 'activated' : 'deactivated'} successfully`,
      ticketsReleased,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Update user role (superadmin only — enforced in the route)
exports.updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body || {};

    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid user id' });
    if (!USER_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const user = await User.findOne({ _id: id, ...NOT_DELETED });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // a superadmin can't change their own role (avoids locking everyone out)
    const denied = checkCanManage(req.user, user);
    if (denied) return res.status(403).json({ error: denied });

    // demoted to "user": their open tickets go back to the team
    const ticketsReleased = role === 'user' ? await releaseOpenTickets(user) : 0;
    user.role = role;
    await user.save();
    await logActivity({
      user: req.user.userId,
      action: `Updated user role to ${role} for ${user.email}${ticketsReleased ? ` (${ticketsReleased} open ticket(s) released)` : ''}`,
      target: user._id,
      targetModel: 'User'
    });

    return res.status(200).json({ message: 'User role updated successfully', ticketsReleased });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Get users who are not activated
exports.getPendingUsers = async (req, res) => {
  try {
    const pendingUsers = await User.find(
      { activated: false, ...NOT_DELETED },
      'username lastname email role createdAt'
    );
    return res.status(200).json(pendingUsers);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Delete user = SOFT delete: hidden and blocked, but kept in the DB,
// so their tickets, messages and activity logs still point to a real user.
// (There is no permanent delete any more.)
exports.softDeleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid user id' });

    const user = await User.findOne({ _id: id, ...NOT_DELETED });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const denied = checkCanManage(req.user, user);
    if (denied) return res.status(403).json({ error: denied });

    user.deleted = true;
    await user.save();
    const ticketsReleased = await releaseOpenTickets(user);
    await logActivity({
      user: req.user.userId,
      action: `Soft deleted user ${user.email}${ticketsReleased ? ` (${ticketsReleased} open ticket(s) released)` : ''}`,
      target: user._id,
      targetModel: 'User'
    });

    return res.status(200).json({ message: 'User deleted successfully', ticketsReleased });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Restore a soft-deleted user (same permission rules as delete)
exports.restoreUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid user id' });

    const user = await User.findOne({ _id: id, deleted: true });
    if (!user) return res.status(404).json({ error: 'Deleted user not found' });

    const denied = checkCanManage(req.user, user);
    if (denied) return res.status(403).json({ error: denied });

    user.deleted = false;
    await user.save();
    await logActivity({
      user: req.user.userId,
      action: `Restored user ${user.email}`,
      target: user._id,
      targetModel: 'User'
    });

    return res.status(200).json({ message: 'User restored successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};
