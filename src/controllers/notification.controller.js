import { sendWhatsappMessage } from '../services/whatsapp.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const sendConfirmationNotification = asyncHandler(async (req, res) => {
  const { phone, patientName, appointmentDate } = req.body;
  const result = await sendWhatsappMessage({
    to: phone,
    body: `Hello ${patientName}, your appointment is confirmed for ${new Date(appointmentDate).toLocaleString()}.`
  });

  sendSuccess(res, 200, 'Confirmation notification processed successfully', result);
});

export const sendCancellationNotification = asyncHandler(async (req, res) => {
  const { phone, patientName } = req.body;
  const result = await sendWhatsappMessage({
    to: phone,
    body: `Hello ${patientName}, your appointment has been cancelled. Please contact the clinic if you need to reschedule.`
  });

  sendSuccess(res, 200, 'Cancellation notification processed successfully', result);
});

export const sendReminderNotification = asyncHandler(async (req, res) => {
  const { phone, patientName, appointmentDate } = req.body;
  const result = await sendWhatsappMessage({
    to: phone,
    body: `Reminder for ${patientName}: your appointment is scheduled for ${new Date(appointmentDate).toLocaleString()}.`
  });

  sendSuccess(res, 200, 'Reminder notification processed successfully', result);
});

