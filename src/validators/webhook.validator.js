import { body } from 'express-validator';

export const vapiWebhookValidation = [
  body('message.type')
    .optional()
    .isString()
    .withMessage('message.type must be a string'),
  body('type').optional().isString().withMessage('type must be a string')
];

