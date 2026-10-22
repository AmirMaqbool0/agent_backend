import { Router } from 'express';

import {
  changeMyPassword,
  createUser,
  fetchSetupStatus,
  fetchUsers,
  getProfile,
  login,
  register,
  removeUser,
  resetPasswordForUser,
  updateMyProfile
} from '../controllers/auth.controller.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { authLimiter } from '../middleware/rateLimiter.middleware.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import {
  changePasswordValidation,
  createUserValidation,
  loginValidation,
  registerValidation,
  resetUserPasswordValidation,
  updateProfileValidation,
  userIdValidation
} from '../validators/auth.validator.js';

const router = Router();

router.get('/setup-status', fetchSetupStatus);
router.post('/register', authLimiter, registerValidation, validateRequest, register);
router.post('/login', authLimiter, loginValidation, validateRequest, login);
router.get('/me', authenticate, getProfile);
router.put('/me', authenticate, updateProfileValidation, validateRequest, updateMyProfile);
router.put(
  '/change-password',
  authenticate,
  changePasswordValidation,
  validateRequest,
  changeMyPassword
);

router.get('/users', authenticate, requireRole('admin'), fetchUsers);
router.post(
  '/users',
  authenticate,
  requireRole('admin'),
  createUserValidation,
  validateRequest,
  createUser
);
router.put(
  '/users/:id/password',
  authenticate,
  requireRole('admin'),
  resetUserPasswordValidation,
  validateRequest,
  resetPasswordForUser
);
router.delete(
  '/users/:id',
  authenticate,
  requireRole('admin'),
  userIdValidation,
  validateRequest,
  removeUser
);

export default router;
