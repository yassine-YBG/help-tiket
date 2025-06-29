const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Register a new user
exports.register = async (req, res) => {
  const { username, lastname, email, password } = req.body;

  try {
    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUser = new User({
      username,
      lastname,
      email,
      password: hashedPassword,
      activated: false,  // user must be activated by superadmin
    });

    await newUser.save();

    return res.status(201).json({ message: 'User registered. Awaiting activation by superadmin.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Login
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    // Check activation
    if (!user.activated) {
      return res.status(403).json({ error: 'Account is not activated' });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid email or password' });

    // Generate JWT
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

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
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};
// Get all users (only for superadmin)
exports.getUsers = async (req, res) => {
  try {
    // Allow access to both admin and superadmin
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: Admins only' });
    }

    // Get all users (you can filter out self or other superadmins if needed)
    const users = await User.find({}, 'username lastname email role activated');

    return res.status(200).json(users);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Delete user
exports.deleteUser = async (req, res) => {
  try {
    // Only admin or superadmin can delete
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: Admins only' });
    }

    const { id } = req.params;

    // Prevent deleting superadmin accounts by admin (optional)
    const userToDelete = await User.findById(id);
    if (!userToDelete) return res.status(404).json({ error: 'User not found' });
    if (userToDelete.role === 'superadmin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Cannot delete superadmin' });
    }

    await User.findByIdAndDelete(id);

    return res.status(200).json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};



// Activate or deactivate user
exports.toggleActivation = async (req, res) => {
  try {
    // Only admin or superadmin can activate/deactivate
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: Admins only' });
    }

    const { id } = req.params;
    const { activated } = req.body; // true or false

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Optional: prevent deactivating superadmin by admin
    if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Cannot change activation of superadmin' });
    }

    user.activated = activated;
    await user.save();

    return res.status(200).json({ message: `User ${activated ? 'activated' : 'deactivated'} successfully` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Update user role

exports.updateRole = async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Access denied: Superadmin only' });
    }

    const { id } = req.params;
    const { role } = req.body; // 'user', 'admin' or 'superadmin'

    if (!['user', 'admin', 'superadmin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Optional: Prevent demoting self or other superadmins
    // if (user._id.equals(req.user.userId) && role !== 'superadmin') {
    //   return res.status(403).json({ error: 'Cannot change your own superadmin role' });
    // }

    user.role = role;
    await user.save();

    return res.status(200).json({ message: 'User role updated successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};
