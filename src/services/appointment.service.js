import { Appointment } from '../models/appointment.model.js';
import { Patient } from '../models/patient.model.js';
import { DateTime, Interval } from 'luxon';
import {
  buildFallbackAvailabilityRange,
  createClinicSlots,
  DEFAULT_SLOT_DURATION_MINUTES,
  resolveAvailabilityRange
} from '../utils/availability.js';
import {
  cancelCalendarEvent,
  createCalendarEvent,
  isCalendarEnabled,
  listCalendarEvents,
  updateCalendarEvent
} from './googleCalendar.service.js';
import {
  draftWhatsappConfirmation,
  draftWhatsappUpdate
} from './openai.service.js';
import {
  normalizePhoneNumber,
  safeSendNotification
} from './twilio.service.js';
import { sendWhatsappMessage } from './whatsapp.service.js';
import {
  formatClinicDate,
  formatClinicDateTime,
  formatClinicTime,
  getClinicConfig,
  resolveClinicTimezone
} from './clinic.service.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import { parseAppointmentDateToDate } from '../utils/dateTime.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { refreshWhatsappStatuses } from './whatsappStatus.service.js';
import { enqueueWhatsappEvent, kickWhatsappOutbox } from './whatsappOutbox.service.js';

// Allow a small grace window so a booking made "right now" is not rejected by clock drift.
const PAST_BOOKING_GRACE_MS = 5 * 60 * 1000;

const toUtcInterval = (startDateTime, endDateTime) =>
  Interval.fromDateTimes(startDateTime.toUTC(), endDateTime.toUTC());

const buildIntervalFromIso = ({ start, end, clinicTimezone }) => {
  const parseDateTime = (value) => {
    if (!value) {
      return null;
    }

    if (value.includes('T')) {
      return DateTime.fromISO(value, { setZone: true }).toUTC();
    }

    return DateTime.fromISO(value, { zone: clinicTimezone }).startOf('day').toUTC();
  };

  const intervalStart = parseDateTime(start);
  const intervalEnd = parseDateTime(end);

  if (!intervalStart?.isValid || !intervalEnd?.isValid || intervalEnd <= intervalStart) {
    return null;
  }

  return toUtcInterval(intervalStart, intervalEnd);
};

const applyNotificationResult = async (appointment, notificationResult) => {
  const sent = Boolean(notificationResult?.success);
  const skipped = Boolean(notificationResult?.providerResult?.skipped);
  const pending = Boolean(notificationResult?.providerResult?.pending);
  const error = notificationResult?.error || '';
  const attemptedAt = notificationResult?.attemptedAt || new Date();
  const status = sent ? 'sent' : pending ? 'pending' : skipped ? 'skipped' : 'failed';

  appointment.notificationStatus = {
    ...(appointment.notificationStatus || {}),
    whatsapp: {
      sent,
      error,
      attemptedAt
    }
  };
  appointment.notificationLogs = [
    ...(appointment.notificationLogs || []),
    {
      channel: notificationResult?.channel || 'whatsapp',
      status,
      reason: error,
      outboxId: notificationResult?.providerResult?.outboxId || null,
      sid: notificationResult?.providerResult?.sid || '',
      template: notificationResult?.providerResult?.usedTemplate || '',
      fallbackBody: notificationResult?.providerResult?.usedTemplate ? notificationResult.providerResult.body || '' : '',
      createdAt: attemptedAt
    }
  ];
  appointment.confirmationSent = sent;
  appointment.whatsappStatus = status;
  appointment.whatsappError = error;
  // Twilio reports final delivery asynchronously; the SID links that report back to this appointment.
  appointment.whatsappMessageSid = notificationResult?.providerResult?.sid || '';
  await appointment.save();
  if (pending) kickWhatsappOutbox();
};

const attachAppointmentMeta = (appointmentDoc, meta = {}) => {
  if (!appointmentDoc) {
    return appointmentDoc;
  }

  const appointment =
    typeof appointmentDoc.toObject === 'function' ? appointmentDoc.toObject() : { ...appointmentDoc };

  return {
    ...appointment,
    ...meta
  };
};

const buildCalendarEventPayload = ({
  reason,
  patient,
  startDate,
  durationMinutes,
  clinicTimezone
}) => ({
  summary: `Patient Appointment - ${patient?.fullName || 'Clinic Patient'}`,
  description: `Patient: ${patient?.fullName || 'Unknown'}\nPhone: ${patient?.phone || 'Unknown'}\nReason: ${
    reason || 'Clinic appointment'
  }`,
  start: {
    dateTime: startDate.toISOString(),
    timeZone: clinicTimezone
  },
  end: {
    dateTime: new Date(startDate.getTime() + durationMinutes * 60 * 1000).toISOString(),
    timeZone: clinicTimezone
  }
});

// Calendar sync never decides whether a booking succeeds: the appointment in MongoDB is the record,
// and calendarStatus tells staff when the Google event needs attention.
const createCalendarEventSafely = async (payload) => {
  if (!isCalendarEnabled()) {
    return { status: 'disabled', eventId: '' };
  }

  try {
    const event = await withRetry(
      () =>
        createCalendarEvent({
          summary: payload.summary,
          description: payload.description,
          start: payload.start.dateTime,
          end: payload.end.dateTime
        }),
      { operationName: 'google-calendar-create' }
    );
    return { status: event?.id ? 'created' : 'failed', eventId: event?.id || '' };
  } catch (error) {
    logger.error(`Google Calendar event creation failed: ${error.message}`);
    return { status: 'failed', eventId: '', error: error.message };
  }
};

const updateCalendarEventSafely = async (eventId, payload) => {
  if (!isCalendarEnabled()) {
    return { status: 'disabled', eventId };
  }

  if (!eventId) {
    return createCalendarEventSafely(payload);
  }

  try {
    const event = await withRetry(
      () =>
        updateCalendarEvent(eventId, {
          summary: payload.summary,
          description: payload.description,
          start: payload.start,
          end: payload.end
        }),
      { operationName: 'google-calendar-reschedule' }
    );
    return { status: 'created', eventId: event?.id || eventId };
  } catch (error) {
    logger.error(`Google Calendar event update failed: ${error.message}`);
    return { status: 'failed', eventId, error: error.message };
  }
};

const deleteCalendarEventSafely = async (eventId) => {
  if (!eventId) {
    return { status: 'deleted' };
  }

  if (!isCalendarEnabled()) {
    return { status: 'disabled' };
  }

  try {
    await withRetry(() => cancelCalendarEvent(eventId), {
      operationName: 'google-calendar-cancel'
    });
    return { status: 'deleted' };
  } catch (error) {
    logger.error(`Google Calendar event deletion failed: ${error.message}`);
    return { status: 'failed', error: error.message };
  }
};

const skippedNotification = (reason) => ({
  success: false,
  channel: 'whatsapp',
  error: reason,
  attemptedAt: new Date(),
  providerResult: { skipped: true }
});

// Approved template for this kind of message, with its variables filled in clinic time.
// Template variables: {{1}} patient name, {{2}} clinic name, {{3}} date, {{4}} time.
const buildTemplate = ({ kind, config, patientName, appointmentDate }) => {
  const contentSid = env.whatsappTemplates[kind];

  if (!contentSid) {
    return null;
  }

  const timezone = resolveClinicTimezone(config);
  return {
    contentSid,
    variables: {
      1: patientName || 'there',
      2: config.clinicName || 'the clinic',
      3: formatClinicDate(appointmentDate, timezone),
      4: formatClinicTime(appointmentDate, timezone)
    }
  };
};

// Respects the WhatsApp and confirmation switches on the Settings page.
const notifyPatient = async ({ appointment, config, kind, phone, patientName, appointmentDate, buildMessage }) => {
  if (!config.whatsappEnabled) {
    return skippedNotification('WhatsApp notifications are turned off in clinic settings');
  }

  if (kind === 'confirmation' && config.confirmationsEnabled === false) {
    return skippedNotification('Booking confirmations are turned off in clinic settings');
  }

  if (env.whatsappProvider === 'web') {
    const when = formatClinicDateTime(appointmentDate, resolveClinicTimezone(config));
    const clinic = config.clinicName || 'the clinic';
    const body = kind === 'confirmation'
      ? `Hello ${patientName}, your appointment with ${clinic} is confirmed for ${when}.`
      : kind === 'reschedule'
        ? `Hello ${patientName}, your appointment with ${clinic} has been rescheduled to ${when}.`
        : `Hello ${patientName}, your appointment with ${clinic} scheduled for ${when} has been cancelled.`;
    try {
      const job = await enqueueWhatsappEvent({ appointment, kind, phone, body });
      return {
        success: false,
        channel: 'whatsapp',
        error: '',
        attemptedAt: new Date(),
        providerResult: { pending: true, outboxId: job._id }
      };
    } catch (error) {
      logger.error(`Could not queue WhatsApp ${kind}: ${error.message}`);
      return {
        success: false,
        channel: 'whatsapp',
        error: `Could not queue WhatsApp message: ${error.message}`,
        attemptedAt: new Date()
      };
    }
  }

  const body = await buildMessage();
  const template = buildTemplate({ kind, config, patientName, appointmentDate });
  const result = await safeSendNotification(
    () =>
      env.whatsappProvider === 'web'
        ? sendWhatsappMessage({ to: phone, body })
        : withRetry(() => sendWhatsappMessage({ to: phone, body, template }), {
            operationName: `twilio-whatsapp-${kind}`
          }),
    'whatsapp'
  );

  if (!result.success) {
    logger.warn(`WhatsApp ${kind} was not delivered: ${result.error || 'unknown reason'}`);
  }

  return result;
};

const buildPhoneCandidates = (value = '') => {
  const normalizedPhone = normalizePhoneNumber(value);

  if (!normalizedPhone) {
    return [];
  }

  return [...new Set([
    normalizedPhone,
    normalizedPhone.startsWith('+92') ? `0${normalizedPhone.slice(3)}` : normalizedPhone,
    normalizedPhone.startsWith('+92') ? normalizedPhone.slice(1) : normalizedPhone,
    normalizedPhone.startsWith('0') ? `+92${normalizedPhone.slice(1)}` : normalizedPhone
  ])];
};

const findAppointmentByIdOrPhone = async ({
  appointmentId,
  phone,
  includeCancelled = false
}) => {
  if (appointmentId) {
    return Appointment.findById(appointmentId).populate('patient');
  }

  const candidatePhones = buildPhoneCandidates(phone);
  if (!candidatePhones.length) {
    throw new ApiError(400, 'appointmentId or phone is required');
  }

  const patient = await Patient.findOne({
    phone: { $in: candidatePhones }
  });

  if (!patient) {
    return null;
  }

  // Prefer the next upcoming active appointment; a caller saying "cancel my appointment"
  // means the one that is still ahead of them.
  const upcomingAppointment = await Appointment.findOne({
    patient: patient._id,
    status: { $nin: ['cancelled', 'completed'] },
    appointmentDate: { $gte: new Date(Date.now() - PAST_BOOKING_GRACE_MS) }
  })
    .populate('patient')
    .sort({ appointmentDate: 1 });

  if (upcomingAppointment) {
    return upcomingAppointment;
  }

  if (!includeCancelled) {
    return null;
  }

  return Appointment.findOne({
    patient: patient._id
  })
    .populate('patient')
    .sort({ appointmentDate: -1 });
};

// Two appointments overlap when each one starts before the other ends.
const findConflictingAppointment = async ({ start, durationMinutes, excludeId }) => {
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  return Appointment.findOne({
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    status: { $nin: ['cancelled'] },
    appointmentDate: { $lt: end },
    $expr: {
      $gt: [
        {
          $add: [
            '$appointmentDate',
            { $multiply: [{ $ifNull: ['$durationMinutes', DEFAULT_SLOT_DURATION_MINUTES] }, 60 * 1000] }
          ]
        },
        start
      ]
    }
  });
};

const assertBookableTime = async ({ start, durationMinutes, excludeId }) => {
  if (start.getTime() < Date.now() - PAST_BOOKING_GRACE_MS) {
    throw new ApiError(400, 'Appointment time must be in the future');
  }

  const conflict = await findConflictingAppointment({ start, durationMinutes, excludeId });
  if (conflict) {
    throw new ApiError(409, 'Selected appointment slot is unavailable');
  }
};

export const getAvailability = async ({ start, end, dateQuery }) => {
  const config = await getClinicConfig();
  const clinicTimezone = resolveClinicTimezone(config);
  const slotDurationMinutes =
    config.appointmentDurationMinutes || DEFAULT_SLOT_DURATION_MINUTES;
  const nowLocal = DateTime.now().setZone(clinicTimezone);
  const { rangeStartUtc, rangeEndUtc, fallbackStrategy, requestedDayLocal } = resolveAvailabilityRange({
    start,
    end,
    dateQuery,
    clinicTimezone,
    config,
    nowLocal
  });

  if (rangeStartUtc >= rangeEndUtc) {
    throw new ApiError(400, 'End date must be later than start date');
  }

  const slots = createClinicSlots({
    config,
    rangeStartUtc,
    rangeEndUtc,
    clinicTimezone,
    slotDurationMinutes
  });

  if (!slots.length) {
    return [];
  }

  const slotRangeStartUtc = DateTime.fromISO(slots[0].start, { setZone: true }).toUTC();
  const slotRangeEndUtc = DateTime.fromISO(slots[slots.length - 1].end, { setZone: true }).toUTC();

  const [calendarEvents, bookedAppointments] = await Promise.all([
    withRetry(
      () => listCalendarEvents(slotRangeStartUtc.toISO(), slotRangeEndUtc.toISO()),
      { operationName: 'google-calendar-list-availability' }
    ).catch((error) => {
      logger.warn(`Availability is using clinic bookings only; Google Calendar list failed: ${error.message}`);
      return [];
    }),
    Appointment.find({
      status: { $nin: ['cancelled'] },
      appointmentDate: { $lt: slotRangeEndUtc.toJSDate() },
      $expr: {
        $gt: [
          {
            $add: [
              '$appointmentDate',
              { $multiply: ['$durationMinutes', 60 * 1000] }
            ]
          },
          slotRangeStartUtc.toJSDate()
        ]
      }
    })
  ]);

  const appointmentBusyIntervals = bookedAppointments.map((appointment) =>
    toUtcInterval(
      DateTime.fromJSDate(new Date(appointment.appointmentDate)).toUTC(),
      DateTime.fromJSDate(new Date(appointment.appointmentDate))
        .toUTC()
        .plus({ minutes: appointment.durationMinutes || slotDurationMinutes })
    )
  );

  const googleBusyIntervals = calendarEvents
    .filter((event) => event.status !== 'cancelled' && event.transparency !== 'transparent')
    .map((event) =>
      buildIntervalFromIso({
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        clinicTimezone
      })
    )
    .filter(Boolean);

  const busyIntervals = [...appointmentBusyIntervals, ...googleBusyIntervals];
  const freeSlots = slots.filter((slot) => {
    const slotInterval = toUtcInterval(
      DateTime.fromISO(slot.start, { setZone: true }).toUTC(),
      DateTime.fromISO(slot.end, { setZone: true }).toUTC()
    );

    return !busyIntervals.some((busyInterval) => busyInterval.overlaps(slotInterval));
  });

  logger.info(
    `[AVAILABILITY] slots=${slots.length} booked=${bookedAppointments.length} googleBusy=${googleBusyIntervals.length} free=${freeSlots.length}`
  );

  if (!freeSlots.length && fallbackStrategy) {
    const fallbackRange = buildFallbackAvailabilityRange({
      config,
      clinicTimezone,
      fallbackStrategy,
      requestedDayLocal
    });

    if (fallbackRange) {
      return getAvailability({
        start: fallbackRange.rangeStartUtc.toISO(),
        end: fallbackRange.rangeEndUtc.toISO()
      });
    }
  }

  return freeSlots;
};

export const createAppointment = async ({
  patientName,
  phone,
  email,
  notes,
  appointmentDate,
  durationMinutes,
  reason,
  source
}) => {
  const config = await getClinicConfig();
  const clinicTimezone = resolveClinicTimezone(config);
  const date = parseAppointmentDateToDate(appointmentDate, { timezone: clinicTimezone });
  const normalizedPhone = normalizePhoneNumber(phone);
  const minutes = Number(durationMinutes) || config.appointmentDurationMinutes || DEFAULT_SLOT_DURATION_MINUTES;

  if (!normalizedPhone) {
    throw new ApiError(400, 'A valid phone number is required');
  }

  await assertBookableTime({ start: date, durationMinutes: minutes });

  const patientUpdates = { fullName: patientName, phone: normalizedPhone };
  if (email) {
    patientUpdates.email = email;
  }
  if (notes) {
    patientUpdates.notes = notes;
  }

  const patient = await Patient.findOneAndUpdate(
    { phone: { $in: buildPhoneCandidates(normalizedPhone) } },
    { $set: patientUpdates },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const appointment = await Appointment.create({
    patient: patient._id,
    appointmentDate: date,
    durationMinutes: minutes,
    reason,
    notes: notes || '',
    source: source || 'phone',
    googleEventId: '',
    calendarStatus: 'pending'
  });
  logger.info(`[BOOKING] appointment saved | id=${appointment._id} | start=${date.toISOString()}`);

  const calendarResult = await createCalendarEventSafely(
    buildCalendarEventPayload({
      reason: reason || notes,
      patient,
      startDate: date,
      durationMinutes: minutes,
      clinicTimezone
    })
  );

  appointment.googleEventId = calendarResult.eventId;
  appointment.calendarStatus = calendarResult.status;
  await appointment.save();

  const spokenDateTime = formatClinicDateTime(date, clinicTimezone);
  const notificationResult = await notifyPatient({
    appointment,
    config,
    kind: 'confirmation',
    phone: patient.phone,
    patientName: patient.fullName,
    appointmentDate: date,
    buildMessage: () =>
      draftWhatsappConfirmation({
        patientName: patient.fullName,
        clinicName: config.clinicName,
        dateTime: spokenDateTime
      })
  });

  await applyNotificationResult(appointment, notificationResult);

  const populatedAppointment = await Appointment.findById(appointment._id).populate('patient');

  return attachAppointmentMeta(populatedAppointment, {
    calendarEventCreated: calendarResult.status === 'created',
    notificationSent: notificationResult.success,
    notificationQueued: Boolean(notificationResult.providerResult?.pending),
    notificationError: notificationResult.error,
    spokenDateTime,
    message: 'Appointment booked successfully.'
  });
};

export const listAppointments = async () => {
  const appointments = await Appointment.find()
    .populate('patient')
    .sort({ appointmentDate: 1 });

  return refreshWhatsappStatuses(appointments);
};

export const sendAppointmentReminder = async (appointmentId) => {
  const appointment = await Appointment.findById(appointmentId).populate('patient');
  if (!appointment || !appointment.patient) throw new ApiError(404, 'Appointment not found');
  if (appointment.status !== 'confirmed' || new Date(appointment.appointmentDate) <= new Date()) {
    throw new ApiError(409, 'Reminders can only be sent for upcoming confirmed appointments');
  }

  const config = await getClinicConfig();
  if (!config.whatsappEnabled || !config.remindersEnabled) {
    throw new ApiError(409, 'WhatsApp reminders are turned off in clinic settings');
  }

  const body = `Hello ${appointment.patient.fullName}, this is a reminder of your appointment with ${config.clinicName} on ${formatClinicDateTime(appointment.appointmentDate, resolveClinicTimezone(config))}.`;
  const result = await safeSendNotification(() => sendWhatsappMessage({ to: appointment.patient.phone, body }));
  await applyNotificationResult(appointment, result);
  if (result.success) {
    appointment.notificationLogs[appointment.notificationLogs.length - 1].reason = 'Reminder sent by staff';
    await appointment.save();
  }
  return Appointment.findById(appointment._id).populate('patient');
};

export const cancelAppointment = async ({
  appointmentId,
  phone,
  cancellationReason = '',
  cancelledBy = 'patient'
}) => {
  const appointment = await findAppointmentByIdOrPhone({
    appointmentId,
    phone,
    includeCancelled: true
  });

  if (!appointment) {
    throw new ApiError(404, 'Appointment not found');
  }

  if (appointment.status === 'cancelled') {
    throw new ApiError(409, 'Appointment is already cancelled.');
  }

  appointment.status = 'cancelled';
  appointment.cancelledAt = new Date();
  appointment.cancelledBy = cancelledBy;
  appointment.cancellationReason = cancellationReason;

  const calendarResult = await deleteCalendarEventSafely(appointment.googleEventId);
  appointment.calendarStatus = calendarResult.status;
  await appointment.save();

  const config = await getClinicConfig();
  const clinicTimezone = resolveClinicTimezone(config);
  const cancellationNotification = appointment.patient
    ? await notifyPatient({
        appointment,
        config,
        kind: 'cancellation',
        phone: appointment.patient.phone,
        patientName: appointment.patient.fullName,
        appointmentDate: appointment.appointmentDate,
        buildMessage: () =>
          draftWhatsappUpdate({
            patientName: appointment.patient.fullName,
            clinicName: config.clinicName,
            dateTime: formatClinicDateTime(appointment.appointmentDate, clinicTimezone),
            updateType: 'cancelled'
          })
      })
    : skippedNotification('Appointment has no linked patient');

  await applyNotificationResult(appointment, cancellationNotification);

  const populatedAppointment = await Appointment.findById(appointment._id).populate('patient');

  return attachAppointmentMeta(populatedAppointment, {
    calendarEventCreated: calendarResult.status === 'deleted',
    notificationSent: cancellationNotification.success,
    notificationQueued: Boolean(cancellationNotification.providerResult?.pending),
    notificationError: cancellationNotification.error,
    message: 'Your appointment has been cancelled successfully.'
  });
};

export const rescheduleAppointment = async ({
  appointmentId,
  appointmentDate,
  newAppointmentDate,
  phone,
  durationMinutes,
  reason
}) => {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!appointmentId && !normalizedPhone) {
    throw new ApiError(400, 'appointmentId or phone is required to reschedule an appointment');
  }

  const appointment = await findAppointmentByIdOrPhone({
    appointmentId,
    phone: normalizedPhone
  });

  if (!appointment || !appointment.patient) {
    throw new ApiError(404, 'Appointment not found');
  }

  if (appointment.status === 'cancelled') {
    throw new ApiError(409, 'Cancelled appointments cannot be rescheduled. Please book a new appointment.');
  }

  const config = await getClinicConfig();
  const clinicTimezone = resolveClinicTimezone(config);
  const nextDate = parseAppointmentDateToDate(newAppointmentDate || appointmentDate, {
    timezone: clinicTimezone
  });
  const minutes = Number(durationMinutes) || appointment.durationMinutes;

  await assertBookableTime({ start: nextDate, durationMinutes: minutes, excludeId: appointment._id });

  const updatedReason = reason || appointment.reason;
  const calendarResult = await updateCalendarEventSafely(
    appointment.googleEventId,
    buildCalendarEventPayload({
      reason: updatedReason,
      patient: appointment.patient,
      startDate: nextDate,
      durationMinutes: minutes,
      clinicTimezone
    })
  );

  appointment.appointmentDate = nextDate;
  appointment.durationMinutes = minutes;
  appointment.reason = updatedReason;
  appointment.status = 'confirmed';
  appointment.googleEventId = calendarResult.eventId || '';
  appointment.calendarStatus = calendarResult.status;
  await appointment.save();

  const spokenDateTime = formatClinicDateTime(nextDate, clinicTimezone);
  const rescheduleNotification = await notifyPatient({
    appointment,
    config,
    kind: 'reschedule',
    phone: appointment.patient.phone,
    patientName: appointment.patient.fullName,
    appointmentDate: nextDate,
    buildMessage: () =>
      draftWhatsappUpdate({
        patientName: appointment.patient.fullName,
        clinicName: config.clinicName,
        dateTime: spokenDateTime,
        updateType: 'rescheduled'
      })
  });

  await applyNotificationResult(appointment, rescheduleNotification);

  const populatedAppointment = await Appointment.findById(appointment._id).populate('patient');

  return attachAppointmentMeta(populatedAppointment, {
    calendarEventCreated: calendarResult.status === 'created',
    notificationSent: rescheduleNotification.success,
    notificationQueued: Boolean(rescheduleNotification.providerResult?.pending),
    notificationError: rescheduleNotification.error,
    spokenDateTime,
    message: 'Appointment rescheduled successfully.'
  });
};

// Dashboard edits. A changed date or duration goes through the reschedule flow so the calendar
// and patient stay in sync; everything else is a plain record update.
export const updateAppointment = async (appointmentId, payload) => {
  const appointment = await Appointment.findById(appointmentId).populate('patient');

  if (!appointment) {
    throw new ApiError(404, 'Appointment not found');
  }

  const nextDuration = payload.durationMinutes ? Number(payload.durationMinutes) : appointment.durationMinutes;
  const nextDate = payload.appointmentDate
    ? parseAppointmentDateToDate(payload.appointmentDate, {
        timezone: resolveClinicTimezone(await getClinicConfig())
      })
    : null;
  const timeChanged =
    (nextDate && nextDate.getTime() !== new Date(appointment.appointmentDate).getTime()) ||
    nextDuration !== appointment.durationMinutes;

  if (appointment.patient) {
    if (payload.patientName) {
      appointment.patient.fullName = payload.patientName;
    }
    if (payload.email !== undefined) {
      appointment.patient.email = payload.email || '';
    }
    await appointment.patient.save();
  }

  if (payload.reason !== undefined) {
    appointment.reason = payload.reason;
  }
  if (payload.notes !== undefined) {
    appointment.notes = payload.notes;
  }
  if (payload.source) {
    appointment.source = payload.source;
  }
  if (payload.status && payload.status !== 'cancelled') {
    appointment.status = payload.status;
  }
  await appointment.save();

  if (timeChanged && appointment.status !== 'cancelled') {
    return rescheduleAppointment({
      appointmentId: appointment._id,
      appointmentDate: (nextDate || appointment.appointmentDate).toISOString(),
      durationMinutes: nextDuration,
      reason: appointment.reason
    });
  }

  return Appointment.findById(appointment._id).populate('patient');
};
