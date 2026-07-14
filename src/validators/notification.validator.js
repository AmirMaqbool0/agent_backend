import { body } from 'express-validator';

const phoneValidation = body('phone')
  .trim()
  .notEmpty()
  .withMessage('Phone is required');

const patientNameValidation = body('patientName')
  .trim()
  .notEmpty()
  .withMessage('Patient name is required');

const appointmentDateValidation = body('appointmentDate')
  .isISO8601()
  .withMessage('Appointment date must be a valid ISO date');

export const confirmationNotificationValidation = [
  phoneValidation,
  patientNameValidation,
  appointmentDateValidation
];

export const cancellationNotificationValidation = [
  phoneValidation,
  patientNameValidation
];

export const reminderNotificationValidation = [
  phoneValidation,
  patientNameValidation,
  appointmentDateValidation
];

