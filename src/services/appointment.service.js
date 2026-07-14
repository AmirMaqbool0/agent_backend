import { Appointment } from '../models/appointment.model.js';
import { Patient } from '../models/patient.model.js';
import { DateTime, Interval } from 'luxon';
import {
  buildFallbackAvailabilityRange,
  createClinicSlots,
  DEFAULT_CLINIC_TIMEZONE,
  DEFAULT_SLOT_DURATION_MINUTES,
  resolveAvailabilityRange
} from '../utils/availability.js';
import {
  cancelCalendarEvent,
  createCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent
} from './googleCalendar.service.js';
import {
  draftWhatsappConfirmation,
  draftWhatsappUpdate
} from './openai.service.js';
import {
  normalizePhoneNumber,
  safeSendNotification,
  sendWhatsappMessage
} from './twilio.service.js';
import { getClinicConfig } from './clinic.service.js';
import { ApiError } from '../utils/apiError.js';
import { parseAppointmentDateToDate } from '../utils/dateTime.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

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
  const error = notificationResult?.error || '';
  const attemptedAt = notificationResult?.attemptedAt || new Date();
  const whatsappStatus = sent ? 'sent' : 'failed';

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
      status: sent ? 'sent' : notificationResult?.providerResult?.skipped ? 'skipped' : 'failed',
      reason: error,
      createdAt: attemptedAt
    }
  ];
  appointment.confirmationSent = sent;
  appointment.whatsappStatus = whatsappStatus;
  appointment.whatsappError = error;
  await appointment.save();
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
  appointment,
  patient,
  startDate,
  durationMinutes,
  clinicTimezone
}) => ({
  summary: `Patient Appointment - ${patient?.fullName || 'Clinic Patient'}`,
  description: `Patient: ${patient?.fullName || 'Unknown'}\nPhone: ${patient?.phone || 'Unknown'}\nReason: ${
    appointment.reason || 'Clinic appointment'
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

  if (includeCancelled) {
    const activeAppointment = await Appointment.findOne({
      patient: patient._id,
      status: { $nin: ['cancelled'] }
    })
      .populate('patient')
      .sort({ appointmentDate: 1 });

    if (activeAppointment) {
      return activeAppointment;
    }

    return Appointment.findOne({
      patient: patient._id
    })
      .populate('patient')
      .sort({ appointmentDate: -1 });
  }

  return Appointment.findOne({
    patient: patient._id,
    status: { $nin: ['cancelled'] }
  })
    .populate('patient')
    .sort({ appointmentDate: 1 });
};

export const getAvailability = async ({ start, end, dateQuery }) => {
  const config = await getClinicConfig();
  const clinicTimezone =
    config.timezone && config.timezone !== 'UTC'
      ? config.timezone
      : DEFAULT_CLINIC_TIMEZONE;
  const slotDurationMinutes =
    config.appointmentDurationMinutes || DEFAULT_SLOT_DURATION_MINUTES;
  const nowLocal = DateTime.now().setZone(clinicTimezone);
  let { rangeStartUtc, rangeEndUtc, fallbackStrategy, requestedDayLocal } = resolveAvailabilityRange({
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

  const localStart = rangeStartUtc.setZone(clinicTimezone);
  const slots = createClinicSlots({
    config,
    rangeStartUtc,
    rangeEndUtc,
    clinicTimezone,
    slotDurationMinutes
  });

  console.log('Incoming UTC start:', rangeStartUtc.toISO());
  console.log('Incoming UTC end:', rangeEndUtc.toISO());
  console.log('Local clinic start:', localStart.toISO());
  console.log('Generated slots:', slots.length);

  if (!slots.length) {
    console.log('Booked appointments:', 0);
    console.log('Google busy events:', 0);
    console.log('Final free slots:', 0);
    return [];
  }

  const slotRangeStartUtc = DateTime.fromISO(slots[0].start, { setZone: true }).toUTC();
  const slotRangeEndUtc = DateTime.fromISO(slots[slots.length - 1].end, { setZone: true }).toUTC();

  const [calendarEvents, bookedAppointments] = await Promise.all([
    withRetry(
      () => listCalendarEvents(slotRangeStartUtc.toISO(), slotRangeEndUtc.toISO()),
      { operationName: 'google-calendar-list-availability' }
    ),
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

  console.log('Booked appointments:', bookedAppointments.length);

  const appointmentBusyIntervals = bookedAppointments.map((appointment) =>
    toUtcInterval(
      DateTime.fromJSDate(new Date(appointment.appointmentDate)).toUTC(),
      DateTime.fromJSDate(new Date(appointment.appointmentDate))
        .toUTC()
        .plus({ minutes: appointment.durationMinutes || slotDurationMinutes })
    )
  );

  const googleBusyIntervals = calendarEvents
    .filter((event) => event.status !== 'cancelled')
    .map((event) =>
      buildIntervalFromIso({
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        clinicTimezone
      })
    )
    .filter(Boolean);

  console.log('Google busy events:', googleBusyIntervals.length);

  const busyIntervals = [...appointmentBusyIntervals, ...googleBusyIntervals];
  const freeSlots = slots.filter((slot) => {
    const slotInterval = toUtcInterval(
      DateTime.fromISO(slot.start, { setZone: true }).toUTC(),
      DateTime.fromISO(slot.end, { setZone: true }).toUTC()
    );

    return !busyIntervals.some((busyInterval) => busyInterval.overlaps(slotInterval));
  });

  console.log('Final free slots:', freeSlots.length);

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
  const date = parseAppointmentDateToDate(appointmentDate);
  const normalizedPhone = normalizePhoneNumber(phone);

  const conflictingAppointment = await Appointment.findOne({
    appointmentDate: {
      $gte: new Date(date.getTime() - 29 * 60 * 1000),
      $lte: new Date(date.getTime() + 29 * 60 * 1000)
    },
    status: { $nin: ['cancelled'] }
  });

  if (conflictingAppointment) {
    throw new ApiError(409, 'Selected appointment slot is unavailable');
  }

  const patient = await Patient.findOneAndUpdate(
    { phone: normalizedPhone },
    {
      fullName: patientName,
      phone: normalizedPhone,
      email,
      notes
    },
    {
      new: true,
      upsert: true
    }
  );

  const config = await getClinicConfig();
  const minutes = durationMinutes || config.appointmentDurationMinutes;

  const appointment = await Appointment.create({
    patient: patient._id,
    appointmentDate: date,
    durationMinutes: minutes,
    reason,
    source: source || 'phone',
    googleEventId: '',
    calendarStatus: 'pending'
  });
  console.log('Appointment saved:', appointment._id.toString());

  const calendarPayload = {
    summary: `Patient Appointment - ${patient.fullName}`,
    description: `Patient: ${patient.fullName}\nPhone: ${patient.phone}\nReason: ${reason || notes || 'General appointment'}`,
    start: date.toISOString(),
    end: new Date(date.getTime() + minutes * 60 * 1000).toISOString()
  };

  let calendarEvent;

  try {
    calendarEvent = await withRetry(
      () => createCalendarEvent(calendarPayload),
      { operationName: 'google-calendar-create' }
    );
  } catch (error) {
    console.error('Google Calendar creation failed', error);
    await appointment.deleteOne();
    throw error;
  }

  appointment.googleEventId = calendarEvent?.id || '';
  appointment.calendarStatus = calendarEvent?.id ? 'created' : 'failed';
  await appointment.save();

  const whatsappMessage = await draftWhatsappConfirmation({
    patientName: patient.fullName,
    clinicName: config.clinicName,
    dateTime: date.toLocaleString()
  });

  const notificationResult = await safeSendNotification(
    () =>
      withRetry(
        () =>
          sendWhatsappMessage({
            to: patient.phone,
            body: whatsappMessage
          }),
        { operationName: 'twilio-whatsapp-confirmation' }
      ),
    'whatsapp'
  );

  if (!notificationResult.success) {
    logger.warn(
      `WhatsApp confirmation was not delivered for appointment ${appointment._id}: ${notificationResult.error || 'unknown reason'}`
    );
  }

  await applyNotificationResult(appointment, notificationResult);

  const populatedAppointment = await Appointment.findById(appointment._id).populate('patient');

  return attachAppointmentMeta(populatedAppointment, {
    calendarEventCreated: Boolean(calendarEvent?.id),
    notificationSent: notificationResult.success,
    notificationError: notificationResult.error,
    message: 'Appointment booked successfully.'
  });
};

export const listAppointments = async () =>
  Appointment.find()
    .populate('patient')
    .sort({ appointmentDate: 1 });

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
  await appointment.save();

  let calendarEventDeleted = false;
  if (appointment.googleEventId) {
    await withRetry(
      async () => {
        const result = await cancelCalendarEvent(appointment.googleEventId);
        calendarEventDeleted = Boolean(result?.success);
        return result;
      },
      { operationName: 'google-calendar-cancel' }
    );
  } else {
    calendarEventDeleted = true;
  }

  appointment.calendarStatus = calendarEventDeleted ? 'deleted' : 'failed';
  await appointment.save();

  const clinic = await getClinicConfig();
  const message = await draftWhatsappUpdate({
    patientName: appointment.patient.fullName,
    clinicName: clinic.clinicName,
    dateTime: new Date(appointment.appointmentDate).toLocaleString(),
    updateType: 'cancelled'
  });

  const cancellationNotification = await safeSendNotification(
    () =>
      withRetry(
        () =>
          sendWhatsappMessage({
            to: appointment.patient.phone,
            body: message
          }),
        { operationName: 'twilio-whatsapp-cancel' }
      ),
    'whatsapp'
  );

  if (!cancellationNotification.success) {
    logger.warn(
      `WhatsApp cancellation message was not delivered for appointment ${appointment._id}: ${cancellationNotification.error || 'unknown reason'}`
    );
  }

  await applyNotificationResult(appointment, cancellationNotification);

  const populatedAppointment = await Appointment.findById(appointment._id).populate('patient');

  return attachAppointmentMeta(populatedAppointment, {
    calendarEventCreated: calendarEventDeleted,
    notificationSent: cancellationNotification.success,
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

  const nextDate = parseAppointmentDateToDate(newAppointmentDate || appointmentDate);

  const minutes = durationMinutes || appointment.durationMinutes;
  const oldAppointmentDate = new Date(appointment.appointmentDate);
  const config = await getClinicConfig();
  const clinicTimezone = config.timezone && config.timezone !== 'UTC'
    ? config.timezone
    : DEFAULT_CLINIC_TIMEZONE;

  const conflictingAppointment = await Appointment.findOne({
    _id: { $ne: appointment._id },
    appointmentDate: {
      $gte: new Date(nextDate.getTime() - 29 * 60 * 1000),
      $lte: new Date(nextDate.getTime() + 29 * 60 * 1000)
    },
    status: { $nin: ['cancelled'] }
  });

  if (conflictingAppointment) {
    throw new ApiError(409, 'Selected appointment slot is unavailable');
  }

  const existingCalendarEventId = appointment.googleEventId || appointment.calendarEventId || '';
  const updatedReason = reason || appointment.reason;
  const calendarEventPayload = buildCalendarEventPayload({
    appointment: {
      ...appointment.toObject(),
      reason: updatedReason
    },
    patient: appointment.patient,
    startDate: nextDate,
    durationMinutes: minutes,
    clinicTimezone
  });

  console.log('Existing calendarEventId:', existingCalendarEventId || 'missing');
  console.log('Old appointment date:', oldAppointmentDate.toISOString());
  console.log('New appointment date:', nextDate.toISOString());

  let resolvedCalendarEventId = existingCalendarEventId;

  if (existingCalendarEventId) {
    try {
      const updatedCalendarEvent = await withRetry(
        () =>
          updateCalendarEvent(existingCalendarEventId, {
            summary: calendarEventPayload.summary,
            description: calendarEventPayload.description,
            start: calendarEventPayload.start,
            end: calendarEventPayload.end
          }),
        { operationName: 'google-calendar-reschedule' }
      );

      resolvedCalendarEventId = updatedCalendarEvent?.id || existingCalendarEventId;
      console.log('Google Calendar update success:', {
        eventId: resolvedCalendarEventId,
        start: calendarEventPayload.start,
        end: calendarEventPayload.end
      });
    } catch (error) {
      console.error('Google Calendar update failure:', error);
      throw error;
    }
  } else {
    try {
      const createdCalendarEvent = await withRetry(
        () =>
          createCalendarEvent({
            summary: calendarEventPayload.summary,
            description: calendarEventPayload.description,
            start: calendarEventPayload.start.dateTime,
            end: calendarEventPayload.end.dateTime
          }),
        { operationName: 'google-calendar-reschedule-create-missing' }
      );

      resolvedCalendarEventId = createdCalendarEvent?.id || '';
      console.log('Google Calendar update success:', {
        eventId: resolvedCalendarEventId,
        createdBecause: 'calendarEventId missing'
      });
    } catch (error) {
      console.error('Google Calendar update failure:', error);
      throw error;
    }
  }

  appointment.appointmentDate = nextDate;
  appointment.durationMinutes = minutes;
  if (reason) {
    appointment.reason = reason;
  }
  appointment.status = 'confirmed';
  appointment.googleEventId = resolvedCalendarEventId;
  appointment.calendarStatus = resolvedCalendarEventId ? 'created' : 'failed';
  await appointment.save();

  const message = await draftWhatsappUpdate({
    patientName: appointment.patient.fullName,
    clinicName: config.clinicName,
    dateTime: nextDate.toLocaleString(),
    updateType: 'rescheduled'
  });

  const rescheduleNotification = await safeSendNotification(
    () =>
      withRetry(
        () =>
          sendWhatsappMessage({
            to: appointment.patient.phone,
            body: message
          }),
        { operationName: 'twilio-whatsapp-reschedule' }
      ),
    'whatsapp'
  );

  if (!rescheduleNotification.success) {
    logger.warn(
      `WhatsApp reschedule message was not delivered for appointment ${appointment._id}: ${rescheduleNotification.error || 'unknown reason'}`
    );
  }

  await applyNotificationResult(appointment, rescheduleNotification);

  const populatedAppointment = await Appointment.findById(appointment._id).populate('patient');

  return attachAppointmentMeta(populatedAppointment, {
    calendarEventCreated: Boolean(resolvedCalendarEventId),
    notificationSent: rescheduleNotification.success,
    notificationError: rescheduleNotification.error,
    message: 'Appointment rescheduled successfully.'
  });
};
