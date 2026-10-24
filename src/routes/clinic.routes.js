import { Router } from 'express';

import {
  fetchClinicConfig,
  fetchIntegrationStatus,
  fetchWhatsappWebStatus,
  updateClinicSettings
} from '../controllers/clinic.controller.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { updateClinicConfigValidation } from '../validators/clinic.validator.js';

const router = Router();

router.get('/config', authenticate, fetchClinicConfig);
router.get('/integrations', authenticate, fetchIntegrationStatus);
router.get('/whatsapp-web', authenticate, requireRole('admin'), fetchWhatsappWebStatus);
router.put(
  '/config',
  authenticate,
  requireRole('admin'),
  updateClinicConfigValidation,
  validateRequest,
  updateClinicSettings
);

export default router;
