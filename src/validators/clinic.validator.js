import { body } from 'express-validator';

export const updateClinicConfigValidation = [
  body('clinicName').optional().trim().notEmpty().withMessage('Clinic name cannot be empty'),
  body('timezone').optional().trim().notEmpty().withMessage('Timezone cannot be empty'),
  body('emergencyTransferNumber')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Emergency transfer number cannot be empty'),
  body('appointmentDurationMinutes')
    .optional()
    .isInt({ min: 10, max: 180 })
    .withMessage('Appointment duration must be between 10 and 180 minutes')
];

