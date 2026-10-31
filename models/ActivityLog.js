const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // who did the action
  action: { type: String, required: true }, // description
  target: { type: String }, // optional, like user ID or ticket ID
  targetModel: { type: String, enum: ['User', 'Ticket'] }, // what kind of thing "target" is (was silently dropped before)
  timestamp: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);
