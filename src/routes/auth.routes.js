import { Router } from 'express';

import { getProfile, login, register } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authLimiter } from '../middleware/rateLimiter.middleware.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { loginValidation, registerValidation } from '../validators/auth.validator.js';

const router = Router();

router.post('/register', authLimiter, registerValidation, validateRequest, register);
router.post('/login', authLimiter, loginValidation, validateRequest, login);
router.get('/me', authenticate, getProfile);

export default router;
