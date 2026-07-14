import { Router } from 'express';

import {
  createNewFaq,
  fetchFaqs,
  removeFaq,
  updateExistingFaq
} from '../controllers/faq.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import {
  createFaqValidation,
  faqIdValidation,
  updateFaqValidation
} from '../validators/faq.validator.js';

const router = Router();

router.get('/', authenticate, fetchFaqs);
router.post('/', authenticate, createFaqValidation, validateRequest, createNewFaq);
router.put('/:id', authenticate, updateFaqValidation, validateRequest, updateExistingFaq);
router.delete('/:id', authenticate, faqIdValidation, validateRequest, removeFaq);

export default router;
