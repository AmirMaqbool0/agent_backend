import { Router } from 'express';

import { handleVapiWebhook } from '../controllers/webhook.controller.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import {
  verifyWebhookSecret,
  verifyWebhookSignature
} from '../middleware/webhook.middleware.js';
import { vapiWebhookValidation } from '../validators/webhook.validator.js';

const router = Router();

router.post(
  '/vapi',
  verifyWebhookSecret,
  verifyWebhookSignature,
  vapiWebhookValidation,
  validateRequest,
  handleVapiWebhook
);

export default router;
