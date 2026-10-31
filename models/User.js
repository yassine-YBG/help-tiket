const mongoose = require('mongoose');
const crypto = require('crypto');
const { USER_ROLES } = require('../utils/validation');

const userSchema = new mongoose.Schema({

  userId: {
    type: String,
    unique: true,
    default: () => {
      const now = new Date();
      const pad = (n) => n.toString().padStart(2, '0');

      const year = now.getFullYear();
      const month = pad(now.getMonth() + 1);
      const day = pad(now.getDate());
      const hour = pad(now.getHours());
      const minute = pad(now.getMinutes());
      const second = pad(now.getSeconds());

      // random suffix: two sign-ups in the same second no longer collide
      const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();

      return `U-${year}${month}${day}T${hour}${minute}${second}-${suffix}`;
    }
  },

  username: {
    type: String,
    required: true,
    trim: true
  },
  lastname: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: USER_ROLES,
    default: 'user'
  },
  activated: {
    type: Boolean,
    default: false
  },
  deleted: {
    type: Boolean,
    default: false
  },
  // tokens created before this date are refused (set when the password changes)
  passwordChangedAt: {
    type: Date,
    default: null
  },

}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
