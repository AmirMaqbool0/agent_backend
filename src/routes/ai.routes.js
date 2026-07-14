import { Router } from 'express';

import {
  generateFaqAnswer,
  generateSentiment,
  generateSummary
} from '../controllers/ai.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import {
  faqValidation,
  sentimentValidation,
  summaryValidation
} from '../validators/ai.validator.js';

const router = Router();

router.post('/summary', authenticate, summaryValidation, validateRequest, generateSummary);
router.post('/sentiment', authenticate, sentimentValidation, validateRequest, generateSentiment);
router.post('/faq', authenticate, faqValidation, validateRequest, generateFaqAnswer);

export default router;

