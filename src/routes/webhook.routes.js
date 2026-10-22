import { Router } from 'express';
import twilio from 'twilio';

import { env } from '../config/env.js';
import { handleVapiWebhook } from '../controllers/webhook.controller.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import {
  verifyWebhookSecret,
  verifyWebhookSignature
} from '../middleware/webhook.middleware.js';
import { applyTwilioStatusCallback } from '../services/whatsappStatus.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';
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

// Twilio signs each callback with the account auth token over the exact public URL it called.
const verifyTwilioSignature = (req, res, next) => {
  const signature = req.headers['x-twilio-signature'];
  const url = `${env.publicBaseUrl}${req.originalUrl}`;

  if (!signature || !env.twilioAuthToken || !twilio.validateRequest(env.twilioAuthToken, signature, url, req.body || {})) {
    logger.warn('[WHATSAPP STATUS] rejected callback with invalid Twilio signature');
    return res.status(403).send('Invalid signature');
  }

  next();
};

router.post(
  '/twilio/status',
  verifyTwilioSignature,
  asyncHandler(async (req, res) => {
    await applyTwilioStatusCallback(req.body || {});
    res.status(204).end();
  })
);

export default router;
