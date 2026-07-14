import { body, param, query } from 'express-validator';

export const patientIdValidation = [
  param('id').isMongoId().withMessage('Patient id must be a valid MongoDB id')
];

export const patientSearchValidation = [
  query('q').trim().notEmpty().withMessage('Search query is required')
];

export const createPatientValidation = [
  body('fullName').trim().notEmpty().withMessage('Full name is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('email')
    .optional({ values: 'falsy' })
    .isEmail()
    .withMessage('Email must be valid'),
  body('dateOfBirth')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Date of birth must be a valid ISO date'),
  body('notes').optional().isString().withMessage('Notes must be a string')
];

export const updatePatientValidation = [
  ...patientIdValidation,
  body('fullName')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Full name cannot be empty'),
  body('phone')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Phone number cannot be empty'),
  body('email')
    .optional({ values: 'falsy' })
    .isEmail()
    .withMessage('Email must be valid'),
  body('dateOfBirth')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Date of birth must be a valid ISO date'),
  body('notes').optional().isString().withMessage('Notes must be a string')
];

