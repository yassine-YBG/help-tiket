// When a support account can no longer work (deactivated, deleted, or demoted to "user"),
// its OPEN tickets are released (handledBy = null) so another admin can take them.
// Without this, nobody could reply: admins must be the handler, and a superadmin's
// tickets cannot be taken by admins at all.
// Resolved tickets keep their handler (history and statistics stay correct).
const Ticket = require('../models/Ticket');

const SUPPORT_ROLES = ['admin', 'superadmin'];

/**
 * @param {object} user  the User document (before the change)
 * @returns {Promise<number>} how many tickets were released
 */
const releaseOpenTickets = async (user) => {
  if (!SUPPORT_ROLES.includes(user.role)) return 0;
  const result = await Ticket.updateMany(
    { handledBy: user._id, status: { $ne: 'résolu' }, deleted: { $ne: true } },
    { $set: { handledBy: null } }
  );
  return result.modifiedCount || 0;
};

module.exports = { releaseOpenTickets, SUPPORT_ROLES };
