import { body } from 'express-validator';

export const summaryValidation = [
  body('transcript')
    .trim()
    .notEmpty()
    .withMessage('Transcript is required')
];

export const sentimentValidation = [
  body('transcript')
    .trim()
    .notEmpty()
    .withMessage('Transcript is required')
];

export const faqValidation = [
  body('question')
    .trim()
    .notEmpty()
    .withMessage('Question is required')
];

