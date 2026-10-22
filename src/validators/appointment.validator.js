import { body, param, query } from 'express-validator';

import { parseAppointmentDateToIso } from '../utils/dateTime.js';

const normalizeAppointmentDate = (fieldName, { optional = false } = {}) => {
  const chain = optional ? body(fieldName).optional({ values: 'falsy' }) : body(fieldName);

  return chain
    .custom((value) => {
      parseAppointmentDateToIso(value);
      return true;
    })
    .withMessage(
      'Appointment date must be a valid ISO date, slash date, or natural-language appointment time'
    )
    .bail()
    .customSanitizer((value) => parseAppointmentDateToIso(value));
};

const durationRule = body('durationMinutes')
  .optional({ values: 'falsy' })
  .isInt({ min: 10, max: 180 })
  .withMessage('Duration must be between 10 and 180 minutes')
  .toInt();

const appointmentIdRule = param('id').isMongoId().withMessage('Appointment id must be a valid MongoDB id');

export const createAppointmentValidation = [
  body('patientName').trim().notEmpty().withMessage('Patient name is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Email must be valid'),
  normalizeAppointmentDate('appointmentDate'),
  durationRule,
  body('reason').optional().isString().trim(),
  body('notes').optional().isString().trim(),
  body('source').optional().isIn(['phone', 'dashboard', 'whatsapp'])
];

export const updateAppointmentValidation = [
  appointmentIdRule,
  body('patientName').optional().trim().notEmpty().withMessage('Patient name cannot be empty'),
  body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Email must be valid'),
  normalizeAppointmentDate('appointmentDate', { optional: true }),
  durationRule,
  body('reason').optional().isString().trim(),
  body('notes').optional().isString().trim(),
  body('source').optional().isIn(['phone', 'dashboard', 'whatsapp']),
  body('status')
    .optional()
    .isIn(['pending', 'confirmed', 'completed'])
    .withMessage('Status must be pending, confirmed, or completed. Use the cancel action to cancel.')
];

// Either an explicit start/end range or a natural-language dateQuery ("tomorrow afternoon").
export const availabilityValidation = [
  query('start').optional().isISO8601().withMessage('Start must be a valid ISO date'),
  query('end').optional().isISO8601().withMessage('End must be a valid ISO date'),
  query('dateQuery').optional().isString().trim(),
  query().custom((value) => {
    if (value.dateQuery || (value.start && value.end)) {
      return true;
    }
    throw new Error('Provide both start and end, or a dateQuery');
  })
];

export const rescheduleAppointmentValidation = [
  appointmentIdRule,
  normalizeAppointmentDate('appointmentDate'),
  durationRule,
  body('reason').optional().isString().withMessage('Reason must be a string')
];

export const cancelAppointmentValidation = [
  appointmentIdRule,
  body('cancellationReason')
    .optional()
    .isString()
    .withMessage('Cancellation reason must be a string'),
  body('cancelledBy')
    .optional()
    .isString()
    .withMessage('Cancelled by must be a string')
];
