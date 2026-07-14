import {
  cancelAppointment,
  createAppointment,
  getAvailability,
  listAppointments,
  rescheduleAppointment
} from '../services/appointment.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const fetchAppointments = asyncHandler(async (_req, res) => {
  const appointments = await listAppointments();
  sendSuccess(res, 200, 'Appointments fetched successfully', appointments);
});

export const createNewAppointment = asyncHandler(async (req, res) => {
  const appointment = await createAppointment(req.body);
  sendSuccess(res, 201, 'Appointment created successfully', appointment);
});

export const fetchAvailability = asyncHandler(async (req, res) => {
  const availability = await getAvailability(req.query);
  sendSuccess(res, 200, 'Availability fetched successfully', availability);
});

export const rescheduleExistingAppointment = asyncHandler(async (req, res) => {
  const appointment = await rescheduleAppointment({
    appointmentId: req.params.id,
    ...req.body
  });

  sendSuccess(res, 200, 'Appointment rescheduled successfully', appointment);
});

export const cancelExistingAppointment = asyncHandler(async (req, res) => {
  const appointment = await cancelAppointment({
    appointmentId: req.params.id,
    ...req.body
  });

  sendSuccess(res, 200, 'Appointment cancelled successfully', appointment);
});
