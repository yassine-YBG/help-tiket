const ActivityLog = require('../models/ActivityLog');

// Call this in any controller to log an action
const logActivity = async ({ user, action, target, targetModel }) => {
  try {
    await ActivityLog.create({
      user,
      action,
      target,
      targetModel
    });
  } catch (err) {
    console.error('❌ Failed to log activity:', err.message);
    // You don't throw it — it's not critical to block the main action
  }
};

module.exports = logActivity;