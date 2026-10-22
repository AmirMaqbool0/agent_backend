import { Appointment } from '../models/appointment.model.js';
import { logger } from '../utils/logger.js';
import { describeWhatsappError, sendWhatsappMessage } from './twilio.service.js';

// Twilio status order: queued -> sent -> delivered -> read, or failed/undelivered at any point.
const STATUS_RANK = { sent: 1, delivered: 2, read: 3 };

// Recipient problems: retrying as free-form text would fail the same way.
const NO_FALLBACK_CODES = new Set(['21211', '21608', '63003', '63015', '63024', '63038']);

const markFailed = (appointment, log, reason) => {
  appointment.whatsappStatus = 'failed';
  appointment.whatsappError = reason;
  appointment.confirmationSent = false;
  appointment.notificationStatus = {
    ...(appointment.notificationStatus?.toObject?.() || appointment.notificationStatus || {}),
    whatsapp: { sent: false, error: reason, attemptedAt: appointment.notificationStatus?.whatsapp?.attemptedAt || new Date() }
  };
  if (log) {
    log.status = 'failed';
    log.reason = reason;
  }
};

// A template that fails after Twilio accepted it (for example, not approved by WhatsApp yet)
// is retried once as free-form text, which still reaches patients inside the 24-hour window.
const retryAsFreeForm = async (appointment, log, reason) => {
  log.fallbackSent = true;
  const result = await sendWhatsappMessage({ to: appointment.patient?.phone, body: log.fallbackBody });

  appointment.notificationLogs.push({
    channel: 'whatsapp',
    status: result.delivered ? 'sent' : 'failed',
    reason: result.delivered ? `Template failed (${reason}); sent as free-form text` : result.error,
    sid: result.sid || '',
    createdAt: new Date()
  });

  if (result.delivered) {
    appointment.whatsappMessageSid = result.sid;
    appointment.whatsappStatus = 'sent';
    appointment.whatsappError = '';
    log.status = 'failed';
    log.reason = reason;
  } else {
    markFailed(appointment, log, result.error || reason);
  }

  logger.info(`[WHATSAPP STATUS] template fallback for appointment=${appointment._id}: ${result.delivered ? 'sent' : 'failed'}`);
};

// Applies a Twilio status callback (MessageSid, MessageStatus, ErrorCode) to the appointment that sent it.
export const applyTwilioStatusCallback = async ({ MessageSid, MessageStatus, ErrorCode, ErrorMessage }) => {
  if (!MessageSid || !MessageStatus) {
    return null;
  }

  const appointment = await Appointment.findOne({ whatsappMessageSid: MessageSid }).populate('patient');
  if (!appointment) {
    logger.info(`[WHATSAPP STATUS] ${MessageSid} ${MessageStatus} (no matching appointment)`);
    return null;
  }

  const log = appointment.notificationLogs?.find((entry) => entry.sid === MessageSid);

  if (['failed', 'undelivered'].includes(MessageStatus)) {
    const reason = describeWhatsappError(ErrorCode, ErrorMessage);
    const canFallBack =
      log?.template && log.fallbackBody && !log.fallbackSent && !NO_FALLBACK_CODES.has(String(ErrorCode));

    if (canFallBack) {
      await retryAsFreeForm(appointment, log, reason);
    } else {
      markFailed(appointment, log, reason);
    }
  } else if (STATUS_RANK[MessageStatus]) {
    // Callbacks can arrive out of order; never move a message backwards (read -> delivered).
    const currentRank = STATUS_RANK[appointment.whatsappStatus] || 0;
    if (STATUS_RANK[MessageStatus] >= currentRank) {
      appointment.whatsappStatus = MessageStatus;
      appointment.whatsappError = '';
    }
  } else {
    return appointment;
  }

  await appointment.save();
  logger.info(`[WHATSAPP STATUS] appointment=${appointment._id} ${MessageSid} -> ${MessageStatus}${ErrorCode ? ` (${ErrorCode})` : ''}`);
  return appointment;
};
