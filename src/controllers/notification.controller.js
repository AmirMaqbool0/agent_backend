import {
  sendCancellation,
  sendConfirmation,
  sendReminder
} from '../services/twilio.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const sendConfirmationNotification = asyncHandler(async (req, res) => {
  const result = await sendConfirmation(req.body);

  sendSuccess(res, 200, 'Confirmation notification processed successfully', result);
});

export const sendCancellationNotification = asyncHandler(async (req, res) => {
  const result = await sendCancellation(req.body);

  sendSuccess(res, 200, 'Cancellation notification processed successfully', result);
});

export const sendReminderNotification = asyncHandler(async (req, res) => {
  const result = await sendReminder(req.body);

  sendSuccess(res, 200, 'Reminder notification processed successfully', result);
});

