import { Router } from 'express';

import {
  sendCancellationNotification,
  sendConfirmationNotification,
  sendReminderNotification
} from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import {
  cancellationNotificationValidation,
  confirmationNotificationValidation,
  reminderNotificationValidation
} from '../validators/notification.validator.js';

const router = Router();

router.post(
  '/confirmation',
  authenticate,
  confirmationNotificationValidation,
  validateRequest,
  sendConfirmationNotification
);
router.post(
  '/cancellation',
  authenticate,
  cancellationNotificationValidation,
  validateRequest,
  sendCancellationNotification
);
router.post(
  '/reminder',
  authenticate,
  reminderNotificationValidation,
  validateRequest,
  sendReminderNotification
);

export default router;

