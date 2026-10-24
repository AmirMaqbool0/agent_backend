import { Appointment } from '../models/appointment.model.js';
import { WhatsappOutbox } from '../models/whatsappOutbox.model.js';
import { logger } from '../utils/logger.js';
import { sendWhatsappWebMessage } from './whatsappWeb.service.js';

let processing = false;
let workerStarted = false;

const updateAppointmentLog = async (job, status, reason = '', messageId = '') => {
  const appointment = await Appointment.findById(job.appointment);
  if (!appointment) return;
  const log = appointment.notificationLogs?.find((entry) => String(entry.outboxId) === String(job._id));
  if (!log) return;
  log.status = status;
  log.reason = reason;
  if (messageId) log.sid = messageId;

  const latest = appointment.notificationLogs[appointment.notificationLogs.length - 1];
  if (String(latest?.outboxId) === String(job._id)) {
    appointment.whatsappStatus = status;
    appointment.whatsappError = reason;
    appointment.whatsappMessageSid = messageId;
    appointment.confirmationSent = ['sent', 'delivered', 'read'].includes(status);
    appointment.notificationStatus = {
      ...(appointment.notificationStatus?.toObject?.() || appointment.notificationStatus || {}),
      whatsapp: { sent: appointment.confirmationSent, error: reason, attemptedAt: new Date() }
    };
  }
  await appointment.save();
};

const isCurrentEvent = (appointment, job) =>
  job.kind === 'cancellation'
    ? appointment.status === 'cancelled'
    : appointment.status === 'confirmed' &&
      new Date(appointment.appointmentDate).getTime() === new Date(job.appointmentDate).getTime();

export const enqueueWhatsappEvent = async ({ appointment, kind, phone, body }) => {
  await WhatsappOutbox.updateMany(
    { appointment: appointment._id, status: 'pending' },
    { $set: { status: 'cancelled', error: 'Superseded by a later appointment change' } }
  );
  for (const log of appointment.notificationLogs || []) {
    if (log.status === 'pending' && log.outboxId) {
      log.status = 'skipped';
      log.reason = 'Superseded by a later appointment change';
    }
  }
  return WhatsappOutbox.create({
    appointment: appointment._id,
    kind,
    appointmentDate: appointment.appointmentDate,
    phone,
    body
  });
};

const handleJob = async (job) => {
  const appointment = await Appointment.findById(job.appointment);
  if (!appointment || !isCurrentEvent(appointment, job)) {
    job.status = 'cancelled';
    job.error = 'Appointment changed before the message could be sent';
    await job.save();
    await updateAppointmentLog(job, 'skipped', job.error);
    return true;
  }

  try {
    const result = await sendWhatsappWebMessage({
      to: job.phone,
      body: job.body,
      beforeSend: async () => {
        const current = await Appointment.findById(job.appointment);
        if (!current || !isCurrentEvent(current, job)) {
          throw new Error('Appointment changed before the message could be sent');
        }
      }
    });
    job.status = 'sent';
    job.messageId = result.sid;
    job.error = '';
    await job.save();
    await updateAppointmentLog(job, 'sent', '', result.sid);
    logger.info(`WhatsApp ${job.kind} accepted for appointment=${job.appointment}`);
    return true;
  } catch (error) {
    if (/appointment changed before/i.test(error.message)) {
      job.status = 'cancelled';
      job.error = error.message;
      await job.save();
      await updateAppointmentLog(job, 'skipped', job.error);
      return true;
    }
    const transient = /connect|socket|stream|timeout|timed out|scan the QR|offline/i.test(error.message);
    if (transient) {
      job.status = 'pending';
      job.nextAttemptAt = new Date(Date.now() + 30000);
      job.error = 'Waiting for the clinic WhatsApp account to reconnect';
      await job.save();
      await updateAppointmentLog(job, 'pending', job.error);
      return false;
    }
    job.status = 'failed';
    job.error = error.message;
    await job.save();
    await updateAppointmentLog(job, 'failed', job.error);
    logger.warn(`WhatsApp ${job.kind} failed for appointment=${job.appointment}: ${error.message}`);
    return true;
  }
};

export const processWhatsappOutbox = async () => {
  if (processing) return;
  processing = true;
  try {
    for (let index = 0; index < 20; index += 1) {
      const job = await WhatsappOutbox.findOneAndUpdate(
        { status: 'pending', nextAttemptAt: { $lte: new Date() } },
        { $set: { status: 'sending' }, $inc: { attempts: 1 } },
        { sort: { createdAt: 1 }, new: true }
      );
      if (!job) break;
      if (!(await handleJob(job))) break;
    }
  } catch (error) {
    logger.error(`WhatsApp outbox processing failed: ${error.message}`);
  } finally {
    processing = false;
  }
};

export const kickWhatsappOutbox = () => {
  setImmediate(() => { processWhatsappOutbox().catch((error) => logger.error(`WhatsApp outbox failed: ${error.message}`)); });
};

export const startWhatsappOutboxWorker = async () => {
  if (workerStarted) return;
  workerStarted = true;
  try {
    // A crash during send has an unknown delivery outcome. Do not resend automatically.
    const uncertain = await WhatsappOutbox.find({ status: 'sending' });
    for (const job of uncertain) {
      job.status = 'failed';
      job.error = 'Delivery uncertain after server restart; check WhatsApp before sending again';
      await job.save();
      await updateAppointmentLog(job, 'failed', job.error);
    }
    kickWhatsappOutbox();
    const timer = setInterval(kickWhatsappOutbox, 15000);
    timer.unref?.();
  } catch (error) {
    workerStarted = false;
    throw error;
  }
};
