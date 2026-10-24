import { Router } from 'express';

import {
  cancelExistingAppointment,
  createNewAppointment,
  fetchAppointments,
  fetchAvailability,
  rescheduleExistingAppointment,
  sendReminderForAppointment,
  updateExistingAppointment
} from '../controllers/appointment.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import {
  availabilityValidation,
  cancelAppointmentValidation,
  createAppointmentValidation,
  rescheduleAppointmentValidation,
  updateAppointmentValidation
} from '../validators/appointment.validator.js';

const router = Router();

router.get('/', authenticate, fetchAppointments);
router.get('/availability', authenticate, availabilityValidation, validateRequest, fetchAvailability);
router.post('/', authenticate, createAppointmentValidation, validateRequest, createNewAppointment);
router.put('/:id', authenticate, updateAppointmentValidation, validateRequest, updateExistingAppointment);
router.put(
  '/:id/reschedule',
  authenticate,
  rescheduleAppointmentValidation,
  validateRequest,
  rescheduleExistingAppointment
);
router.put(
  '/:id/cancel',
  authenticate,
  cancelAppointmentValidation,
  validateRequest,
  cancelExistingAppointment
);
router.post('/:id/reminder', authenticate, sendReminderForAppointment);

export default router;
