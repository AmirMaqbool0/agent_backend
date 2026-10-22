import { body } from 'express-validator';

export const updateClinicConfigValidation = [
  body('clinicName').optional({ checkFalsy: true }).trim().notEmpty().withMessage('Clinic name cannot be empty'),
  body('timezone')
    .optional({ checkFalsy: true })
    .trim()
    .custom((value) => {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    })
    .withMessage('Timezone must be a valid IANA timezone such as Asia/Karachi'),
  body('clinicPhone').optional({ checkFalsy: true }).trim(),
  body('address').optional({ checkFalsy: true }).trim(),
  body('emergencyTransferNumber')
    .optional({ checkFalsy: true })
    .trim()
    .notEmpty()
    .withMessage('Emergency transfer number cannot be empty'),
  body('appointmentDurationMinutes')
    .optional()
    .isInt({ min: 10, max: 180 })
    .withMessage('Appointment duration must be between 10 and 180 minutes')
    .toInt(),
  body('workingHours').optional().isObject().withMessage('Working hours must be an object'),
  body('whatsappEnabled').optional().isBoolean().withMessage('WhatsApp enabled must be true or false').toBoolean(),
  body('confirmationsEnabled').optional().isBoolean().withMessage('Confirmations enabled must be true or false').toBoolean(),
  body('remindersEnabled').optional().isBoolean().withMessage('Reminders enabled must be true or false').toBoolean(),
  body('alertsEnabled').optional().isBoolean().withMessage('Alerts enabled must be true or false').toBoolean(),
  body('assistantPersonality').optional({ checkFalsy: true }).trim(),
  body('aiLanguage').optional({ checkFalsy: true }).trim(),
  body('responseTone').optional({ checkFalsy: true }).trim(),
  body('escalationRules').optional({ checkFalsy: true }).trim()
];
