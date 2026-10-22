import {
  changePassword,
  createStaffUser,
  deleteUser,
  listUsers,
  loginUser,
  needsInitialSetup,
  registerUser,
  resetUserPassword,
  updateProfile
} from '../services/auth.service.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const fetchSetupStatus = asyncHandler(async (_req, res) => {
  sendSuccess(res, 200, 'Setup status fetched successfully', {
    needsSetup: await needsInitialSetup()
  });
});

// Open only while no account exists, so the first person to install the app becomes the admin.
// After that, new accounts are created by an admin from the Team settings.
export const register = asyncHandler(async (req, res) => {
  if (!(await needsInitialSetup())) {
    throw new ApiError(403, 'Registration is closed. Ask a clinic admin to create your account.');
  }

  const result = await registerUser({ ...req.body, role: 'admin' });
  sendSuccess(res, 201, 'Admin account created successfully', result);
});

export const login = asyncHandler(async (req, res) => {
  const result = await loginUser(req.body);
  sendSuccess(res, 200, 'Login successful', result);
});

export const getProfile = asyncHandler(async (req, res) => {
  sendSuccess(res, 200, 'Profile fetched successfully', req.user);
});

export const updateMyProfile = asyncHandler(async (req, res) => {
  const user = await updateProfile(req.user._id, req.body);
  sendSuccess(res, 200, 'Profile updated successfully', user);
});

export const changeMyPassword = asyncHandler(async (req, res) => {
  await changePassword(req.user._id, req.body);
  sendSuccess(res, 200, 'Password changed successfully');
});

export const fetchUsers = asyncHandler(async (_req, res) => {
  sendSuccess(res, 200, 'Users fetched successfully', await listUsers());
});

export const createUser = asyncHandler(async (req, res) => {
  const user = await createStaffUser(req.body);
  sendSuccess(res, 201, 'User created successfully', user);
});

export const resetPasswordForUser = asyncHandler(async (req, res) => {
  await resetUserPassword(req.params.id, req.body);
  sendSuccess(res, 200, 'Password reset successfully');
});

export const removeUser = asyncHandler(async (req, res) => {
  await deleteUser(req.user._id, req.params.id);
  sendSuccess(res, 200, 'User deleted successfully');
});
