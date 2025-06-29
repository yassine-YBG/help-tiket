const mongoose = require('mongoose');

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

      return `U-${year}${month}${day}T${hour}${minute}${second}`;
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
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'superadmin'],
    default: 'user'
  },
  activated: {
    type: Boolean,
    default: false 
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
