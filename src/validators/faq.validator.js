import { body, param } from 'express-validator';

export const createFaqValidation = [
  body('question').trim().notEmpty().withMessage('Question is required'),
  body('answer').trim().notEmpty().withMessage('Answer is required'),
  body('category').trim().notEmpty().withMessage('Category is required')
];

export const updateFaqValidation = [
  param('id').isMongoId().withMessage('FAQ id must be a valid MongoDB id'),
  body('question').optional().trim().notEmpty().withMessage('Question cannot be empty'),
  body('answer').optional().trim().notEmpty().withMessage('Answer cannot be empty'),
  body('category').optional().trim().notEmpty().withMessage('Category cannot be empty')
];

export const faqIdValidation = [
  param('id').isMongoId().withMessage('FAQ id must be a valid MongoDB id')
];
