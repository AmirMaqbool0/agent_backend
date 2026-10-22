import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.js';
import { signToken } from '../utils/jwt.js';

const toPublicUser = (user) => ({
  id: user._id,
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
});

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

export const needsInitialSetup = async () => (await User.estimatedDocumentCount()) === 0;

export const registerUser = async ({ name, email, password, role }) => {
  const normalizedEmail = normalizeEmail(email);
  const existingUser = await User.findOne({ email: normalizedEmail });

  if (existingUser) {
    throw new ApiError(409, 'User with this email already exists');
  }

  const user = await User.create({ name, email: normalizedEmail, password, role });
  const token = signToken({ userId: user._id });

  return {
    token,
    user: toPublicUser(user)
  };
};

export const loginUser = async ({ email, password }) => {
  const user = await User.findOne({ email: normalizeEmail(email) });

  if (!user) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    throw new ApiError(401, 'Invalid email or password');
  }

  return {
    token: signToken({ userId: user._id }),
    user: toPublicUser(user)
  };
};

export const updateProfile = async (userId, { name, email }) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (email !== undefined) {
    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail !== user.email) {
      const emailTaken = await User.exists({ email: normalizedEmail, _id: { $ne: userId } });
      if (emailTaken) {
        throw new ApiError(409, 'Another account already uses this email');
      }
      user.email = normalizedEmail;
    }
  }

  if (name !== undefined) {
    user.name = name;
  }

  await user.save();
  return toPublicUser(user);
};

export const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const isPasswordValid = await user.comparePassword(currentPassword);
  if (!isPasswordValid) {
    throw new ApiError(400, 'Current password is incorrect');
  }

  user.password = newPassword;
  await user.save();
};

export const listUsers = async () => {
  const users = await User.find().sort({ createdAt: 1 });
  return users.map(toPublicUser);
};

export const createStaffUser = async ({ name, email, password, role = 'staff' }) => {
  const { user } = await registerUser({ name, email, password, role });
  return user;
};

export const resetUserPassword = async (userId, { password }) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  user.password = password;
  await user.save();
};

export const deleteUser = async (actingUserId, userId) => {
  if (String(actingUserId) === String(userId)) {
    throw new ApiError(400, 'You cannot delete your own account');
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.role === 'admin') {
    const adminCount = await User.countDocuments({ role: 'admin' });
    if (adminCount <= 1) {
      throw new ApiError(400, 'At least one admin account must remain');
    }
  }

  await user.deleteOne();
};
