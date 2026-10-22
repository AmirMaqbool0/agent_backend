import {
  cancelAppointment,
  createAppointment,
  getAvailability,
  listAppointments,
  rescheduleAppointment,
  updateAppointment
} from '../services/appointment.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const fetchAppointments = asyncHandler(async (_req, res) => {
  const appointments = await listAppointments();
  sendSuccess(res, 200, 'Appointments fetched successfully', appointments);
});

export const createNewAppointment = asyncHandler(async (req, res) => {
  const appointment = await createAppointment({ source: 'dashboard', ...req.body });
  sendSuccess(res, 201, 'Appointment created successfully', appointment);
});

export const updateExistingAppointment = asyncHandler(async (req, res) => {
  const appointment = await updateAppointment(req.params.id, req.body);
  sendSuccess(res, 200, 'Appointment updated successfully', appointment);
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
    cancelledBy: 'staff',
    ...req.body,
    appointmentId: req.params.id
  });

  sendSuccess(res, 200, 'Appointment cancelled successfully', appointment);
});
