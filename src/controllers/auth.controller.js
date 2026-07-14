import { loginUser, registerUser } from '../services/auth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const register = asyncHandler(async (req, res) => {
  const result = await registerUser(req.body);
  sendSuccess(res, 201, 'User registered successfully', result);
});

export const login = asyncHandler(async (req, res) => {
  const result = await loginUser(req.body);
  sendSuccess(res, 200, 'Login successful', result);
});

export const getProfile = asyncHandler(async (req, res) => {
  sendSuccess(res, 200, 'Profile fetched successfully', req.user);
});

