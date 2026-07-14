import { Router } from 'express';

import {
  fetchClinicConfig,
  updateClinicSettings
} from '../controllers/clinic.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { updateClinicConfigValidation } from '../validators/clinic.validator.js';

const router = Router();

router.get('/config', authenticate, fetchClinicConfig);
router.put(
  '/config',
  authenticate,
  updateClinicConfigValidation,
  validateRequest,
  updateClinicSettings
);

export default router;

