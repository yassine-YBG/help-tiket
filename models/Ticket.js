const mongoose = require('mongoose');
const { TICKET_STATUSES, TICKET_PRIORITIES, PRIORITY_WEIGHT } = require('../utils/validation');

const ticketSchema = new mongoose.Schema({
  subject: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true }, // e.g. YouTube, Spotify, etc.
  priority: {
    type: String,
    enum: TICKET_PRIORITIES,
    default: 'normal'
  },
  status: {
    type: String,
    enum: TICKET_STATUSES,
    default: 'non résolu'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  handledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // we’ll populate this to get the admin name
  },
  deleted: { type: Boolean, default: false },
  // set when the status becomes "résolu", cleared if the ticket is reopened
  // (used by the admin stats: average resolution time)
  resolvedAt: { type: Date, default: null },
  messages: [{
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: String,
    attachments: [{
      filename: String,
      originalName: String,
      path: String,
      mimetype: String,
      size: Number,
      uploadedAt: { type: Date, default: Date.now }
    }],
    sentAt: { type: Date, default: Date.now }
  }],
  attachments: [{
    filename: String,
    originalName: String,
    path: String,
    mimetype: String,
    size: Number,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

// Index: make the list queries fast when there are many tickets
// (admin list sorted by date, "my tickets", filters by status / handler)
ticketSchema.index({ deleted: 1, createdAt: -1 });
ticketSchema.index({ createdBy: 1, deleted: 1, createdAt: -1 });
ticketSchema.index({ status: 1, createdAt: -1 });
ticketSchema.index({ handledBy: 1, createdAt: -1 });

// Poids de la priorité (utile pour le tri côté JS et pour le frontend)
ticketSchema.virtual('priorityWeight').get(function () {
  return PRIORITY_WEIGHT[this.priority] || PRIORITY_WEIGHT.normal;
});

//  inclure les virtuels dans les réponses JSON
ticketSchema.set('toJSON', { virtuals: true });
ticketSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Ticket', ticketSchema);
