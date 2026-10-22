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
  error: describeWhatsappError(error?.code, error?.message || error) || 'WhatsApp delivery failed',
  errorCode: error?.code
});

// Recipient problems: a free-form retry would fail the same way, so do not fall back for these.
const RECIPIENT_ERROR_CODES = new Set([21211, 21608, 63003, 63015, 63024, 63038]);

const statusCallbackOptions = () =>
  // Twilio only accepts the message here; delivery or failure is reported later to this URL.
  env.publicBaseUrl ? { statusCallback: `${env.publicBaseUrl}/api/webhooks/twilio/status` } : {};

const buildSentResult = ({ response, body, usedTemplate, templateError = '' }) => ({
  success: true,
  whatsappStatus: 'sent',
  whatsappError: '',
  delivered: true,
  skipped: false,
  sid: response.sid,
  status: response.status,
  to: response.to,
  body,
  usedTemplate,
  templateError
});

// Sends a WhatsApp message. With `template` ({ contentSid, variables }) it sends the approved
// template first and falls back to the free-form `body` if Twilio rejects the template.
// Free-form text only reaches people who messaged the clinic in the last 24 hours.
export const sendWhatsappMessage = async ({ to, body, template }, { client: injectedClient } = {}) => {
  const client = injectedClient || getTwilioClient();
  const from = env.twilioWhatsappFrom;
  const normalizedTo = normalizeWhatsappNumber(to);
  const contentSid = template?.contentSid?.trim();

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

  let templateError = '';

  if (contentSid) {
    try {
      const response = await client.messages.create({
        from,
        to: normalizedTo,
        contentSid,
        contentVariables: JSON.stringify(template.variables || {}),
        ...statusCallbackOptions()
      });

      logger.info(`[TWILIO] template ${contentSid} sent | sid=${response.sid}`);
      return buildSentResult({ response, body, usedTemplate: contentSid });
    } catch (error) {
      if (RECIPIENT_ERROR_CODES.has(Number(error.code))) {
        logger.error(`WhatsApp template failed for recipient: ${error.message}`);
        return buildFailedWhatsappResult({ to: normalizedTo, body, error });
      }

      templateError = describeWhatsappError(error.code, error.message);
      logger.warn(`[TWILIO] template ${contentSid} rejected (${error.code}); falling back to free-form text`);
    }
  }

  try {
    const response = await client.messages.create({
      from,
      to: normalizedTo,
      body,
      ...statusCallbackOptions()
    });

    logger.info(`[TWILIO] free-form message sent | sid=${response.sid}`);
    return buildSentResult({ response, body, usedTemplate: '', templateError });
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

// Plain-language explanations for the Twilio WhatsApp errors clinics run into most.
const WHATSAPP_ERROR_HINTS = {
  63015: 'Patient has not joined the Twilio WhatsApp sandbox (they must send the join code first).',
  63016: 'Outside the 24-hour WhatsApp window; an approved message template is required.',
  63038: 'Twilio trial daily message limit reached. Try again tomorrow or upgrade the account.',
  63003: 'The phone number is not on WhatsApp.',
  63024: 'Invalid recipient phone number.',
  21655: 'The WhatsApp template ID (ContentSid) is invalid for this Twilio account.',
  21656: 'The WhatsApp template variables do not match the template.',
  63027: 'The WhatsApp template was not approved or does not exist for this sender.',
  63049: 'WhatsApp chose not to deliver this marketing-style message.',
  21211: 'Invalid recipient phone number.',
  21608: 'Trial accounts can only message verified numbers.'
};

export const describeWhatsappError = (code, fallback = '') =>
  WHATSAPP_ERROR_HINTS[Number(code)] || (code ? `WhatsApp delivery failed (Twilio error ${code})${fallback ? `: ${fallback}` : ''}` : fallback);

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
