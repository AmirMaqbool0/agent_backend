import crypto from 'node:crypto';

import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const extractProvidedSecret = (req) => {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : '';

  return req.headers['x-vapi-secret'] || req.headers['x-webhook-secret'] || bearer || '';
};

// Protects the Vapi webhook once VAPI_WEBHOOK_SECRET is set. Configure the same value as the
// "Server URL Secret" on the Vapi assistant/phone number; Vapi sends it as the x-vapi-secret header.
// Without the variable the endpoint stays open (with a warning) so existing deployments keep working.
export const verifyWebhookSecret = (req, _res, next) => {
  if (!env.vapiWebhookSecret) {
    if (env.nodeEnv === 'production') {
      logger.warn('VAPI_WEBHOOK_SECRET is not set; the Vapi webhook accepts unauthenticated requests');
    }
    return next();
  }

  const providedSecret = extractProvidedSecret(req);

  if (!providedSecret || !safeEqual(providedSecret, env.vapiWebhookSecret)) {
    return next(new ApiError(401, 'Invalid webhook secret'));
  }

  next();
};

export const verifyWebhookSignature = (_req, _res, next) => {
  next();
};
