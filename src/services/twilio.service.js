import twilio from 'twilio';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const getTwilioClient = () => {
  if (!env.twilioAccountSid || !env.twilioAuthToken) {
    return null;
  }

  return twilio(env.twilioAccountSid, env.twilioAuthToken);
};

export const normalizePhoneNumber = (value = '') => {
  const rawValue = String(value || '')
    .trim()
    .replace(/^whatsapp:/i, '')
    .replace(/[^\d+]/g, '');

  if (!rawValue) {
    return '';
  }

  if (rawValue.startsWith('+')) {
    return rawValue;
  }

  if (/^92\d{10}$/.test(rawValue)) {
    return `+${rawValue}`;
  }

  if (/^0\d{10}$/.test(rawValue)) {
    return `+92${rawValue.slice(1)}`;
  }

  if (/^3\d{9}$/.test(rawValue)) {
    return `+92${rawValue}`;
  }

  return `+${rawValue}`;
};

const normalizeWhatsappNumber = (value = '') => {
  const phone = normalizePhoneNumber(value);
  return phone ? `whatsapp:${phone}` : '';
};

const buildFailedWhatsappResult = ({ to, body, error, skipped = false }) => ({
  success: true,
  whatsappStatus: 'failed',
  whatsappError: error?.message || error || 'WhatsApp delivery failed',
  delivered: false,
  skipped,
  to,
  body,
  error: error?.message || error || 'WhatsApp delivery failed',
  errorCode: error?.code
});

export const sendWhatsappMessage = async ({ to, body }) => {
  const client = getTwilioClient();
  const from = env.twilioWhatsappFrom;
  const normalizedTo = normalizeWhatsappNumber(to);

  if (!normalizedTo) {
    const error = 'WhatsApp recipient phone number is required';
    console.error('[TWILIO FAILED]', undefined, error);
    return buildFailedWhatsappResult({
      to: normalizedTo,
      body,
      error
    });
  }

  if (!client || !from) {
    logger.warn('Twilio WhatsApp credentials missing, skipping message send');
    console.error('[TWILIO FAILED]', undefined, 'Twilio WhatsApp credentials missing');
    return buildFailedWhatsappResult({
      to: normalizedTo,
      body,
      error: 'Twilio WhatsApp credentials missing',
      skipped: true
    });
  }

  try {
    console.log('[TWILIO SEND]', {
      from,
      to: normalizedTo,
      body
    });

    const response = await client.messages.create({
      from,
      to: normalizedTo,
      body
    });

    console.log('[TWILIO SUCCESS]', response.sid);

    return {
      success: true,
      whatsappStatus: 'sent',
      whatsappError: '',
      delivered: true,
      skipped: false,
      sid: response.sid,
      status: response.status,
      to: response.to,
      body
    };
  } catch (error) {
    logger.error(`WhatsApp failed: ${error.message}`);
    console.error('[TWILIO FAILED]', error.code, error.message);

    return buildFailedWhatsappResult({
      to: normalizedTo,
      body,
      error
    });
  }
};

export const safeSendNotification = async (sendOperation, channel = 'whatsapp') => {
  const attemptedAt = new Date();
  const defaultFailure = {
    success: false,
    channel,
    error: 'Notification failed',
    attemptedAt
  };

  try {
    const result = await sendOperation();

    if (result?.delivered) {
      return {
        success: true,
        channel,
        error: null,
        attemptedAt,
        whatsappStatus: 'sent',
        whatsappError: '',
        providerResult: result
      };
    }

    const error =
      result?.whatsappError ||
      result?.error ||
      result?.reason ||
      'Notification failed';
    logger.error(`${channel} notification failed: ${error}`);

    return {
      success: false,
      channel,
      error,
      attemptedAt,
      whatsappStatus: 'failed',
      whatsappError: error,
      providerResult: result
    };
  } catch (error) {
    logger.error(`${channel} notification failed: ${error.message}`);

    return {
      ...defaultFailure,
      error: error.message,
      whatsappStatus: 'failed',
      whatsappError: error.message
    };
  }
};

export const sendConfirmation = async ({ phone, patientName, appointmentDate }) => {
  const body = `Hello ${patientName}, your appointment is confirmed for ${new Date(
    appointmentDate
  ).toLocaleString()}.`;

  return sendWhatsappMessage({
    to: phone,
    body
  });
};

export const sendCancellation = async ({ phone, patientName }) => {
  const body = `Hello ${patientName}, your appointment has been cancelled. Please contact the clinic if you need to reschedule.`;

  return sendWhatsappMessage({
    to: phone,
    body
  });
};

export const sendReminder = async ({ phone, patientName, appointmentDate }) => {
  const body = `Reminder for ${patientName}: your appointment is scheduled for ${new Date(
    appointmentDate
  ).toLocaleString()}.`;

  return sendWhatsappMessage({
    to: phone,
    body
  });
};
