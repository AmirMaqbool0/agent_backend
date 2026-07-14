import { body, param, query } from 'express-validator';

import { parseAppointmentDateToIso } from '../utils/dateTime.js';

const normalizeAppointmentDate = (fieldName) =>
  body(fieldName)
    .custom((value) => {
      parseAppointmentDateToIso(value);
      return true;
    })
    .withMessage(
      'Appointment date must be a valid ISO date, slash date, or natural-language appointment time'
    )
    .bail()
    .customSanitizer((value) => parseAppointmentDateToIso(value));

export const createAppointmentValidation = [
  body('patientName').trim().notEmpty().withMessage('Patient name is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('email').optional().isEmail().withMessage('Email must be valid'),
  normalizeAppointmentDate('appointmentDate'),
  body('durationMinutes').optional().isInt({ min: 10, max: 180 }),
  body('source').optional().isIn(['phone', 'dashboard', 'whatsapp'])
];

export const availabilityValidation = [
  query('start').isISO8601().withMessage('Start date is required'),
  query('end').isISO8601().withMessage('End date is required')
];

export const rescheduleAppointmentValidation = [
  param('id').isMongoId().withMessage('Appointment id must be a valid MongoDB id'),
  normalizeAppointmentDate('appointmentDate'),
  body('durationMinutes').optional().isInt({ min: 10, max: 180 }),
  body('reason').optional().isString().withMessage('Reason must be a string')
];

export const cancelAppointmentValidation = [
  param('id').isMongoId().withMessage('Appointment id must be a valid MongoDB id'),
  body('cancellationReason')
    .optional()
    .isString()
    .withMessage('Cancellation reason must be a string'),
  body('cancelledBy')
    .optional()
    .isString()
    .withMessage('Cancelled by must be a string')
];
