import {
  createFaq,
  deleteFaq,
  listFaqs,
  updateFaq
} from '../services/faq.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { logger } from '../utils/logger.js';

export const fetchFaqs = asyncHandler(async (_req, res) => {
  logger.info('FAQ route hit: GET /api/faq');
  const faqs = await listFaqs();
  sendSuccess(res, 200, 'FAQs fetched successfully', faqs);
});

export const createNewFaq = asyncHandler(async (req, res) => {
  logger.info('FAQ route hit: POST /api/faq');
  const faq = await createFaq(req.body);
  sendSuccess(res, 201, 'FAQ created successfully', faq);
});

export const updateExistingFaq = asyncHandler(async (req, res) => {
  logger.info(`FAQ route hit: PUT /api/faq/${req.params.id}`);
  const faq = await updateFaq(req.params.id, req.body);
  sendSuccess(res, 200, 'FAQ updated successfully', faq);
});

export const removeFaq = asyncHandler(async (req, res) => {
  logger.info(`FAQ route hit: DELETE /api/faq/${req.params.id}`);
  await deleteFaq(req.params.id);
  sendSuccess(res, 200, 'FAQ deleted successfully');
});
