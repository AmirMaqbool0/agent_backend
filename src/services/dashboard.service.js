import { DateTime } from 'luxon';

import { Appointment } from '../models/appointment.model.js';
import { CallLog } from '../models/callLog.model.js';
import { Patient } from '../models/patient.model.js';
import { getClinicConfig, resolveClinicTimezone } from './clinic.service.js';

const BOOKING_OUTCOMES = ['booked', 'rescheduled'];

const percent = (part, total) => (total ? Math.round((part / total) * 100) : 0);

// Period-over-period change; null when there is no earlier data to compare against.
const change = (current, previous) => (previous ? Math.round(((current - previous) / previous) * 100) : null);

export const getDashboardMetrics = async ({ days = 14 } = {}) => {
  const rangeDays = Math.min(Math.max(Number(days) || 14, 1), 90);
  const config = await getClinicConfig();
  const timezone = resolveClinicTimezone(config);
  const nowLocal = DateTime.now().setZone(timezone);
  const todayStart = nowLocal.startOf('day');
  const rangeStart = todayStart.minus({ days: rangeDays - 1 });
  const previousRangeStart = rangeStart.minus({ days: rangeDays });

  const [calls, previousCallCount, appointments, previousAppointmentCount, totalPatients, newPatients, todayAppointments, upcomingAppointments] =
    await Promise.all([
      CallLog.find({ createdAt: { $gte: rangeStart.toJSDate() } })
        .select('callerName patientName phone status sentiment durationSeconds summary bookingOutcome transferOutcome startedAt createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      CallLog.countDocuments({
        createdAt: { $gte: previousRangeStart.toJSDate(), $lt: rangeStart.toJSDate() }
      }),
      Appointment.find({ createdAt: { $gte: rangeStart.toJSDate() } })
        .select('status source createdAt appointmentDate')
        .lean(),
      Appointment.countDocuments({
        createdAt: { $gte: previousRangeStart.toJSDate(), $lt: rangeStart.toJSDate() }
      }),
      Patient.estimatedDocumentCount(),
      Patient.countDocuments({ createdAt: { $gte: rangeStart.toJSDate() } }),
      Appointment.find({
        appointmentDate: {
          $gte: todayStart.toJSDate(),
          $lt: todayStart.plus({ days: 1 }).toJSDate()
        },
        status: { $ne: 'cancelled' }
      })
        .populate('patient')
        .sort({ appointmentDate: 1 })
        .lean(),
      Appointment.find({
        appointmentDate: { $gte: nowLocal.toJSDate() },
        status: { $nin: ['cancelled', 'completed'] }
      })
        .populate('patient')
        .sort({ appointmentDate: 1 })
        .limit(6)
        .lean()
    ]);

  const dayKey = (value) => DateTime.fromJSDate(new Date(value)).setZone(timezone).toISODate();
  const series = Array.from({ length: rangeDays }, (_, index) => {
    const day = rangeStart.plus({ days: index });
    return { date: day.toISODate(), label: day.toFormat('LLL d'), calls: 0, bookings: 0 };
  });
  const seriesByDate = new Map(series.map((item) => [item.date, item]));

  for (const call of calls) {
    const bucket = seriesByDate.get(dayKey(call.startedAt || call.createdAt));
    if (bucket) {
      bucket.calls += 1;
    }
  }

  for (const appointment of appointments) {
    const bucket = seriesByDate.get(dayKey(appointment.createdAt));
    if (bucket) {
      bucket.bookings += 1;
    }
  }

  const finishedCalls = calls.filter((call) => call.durationSeconds > 0);
  const averageCallDuration = finishedCalls.length
    ? Math.round(finishedCalls.reduce((sum, call) => sum + call.durationSeconds, 0) / finishedCalls.length)
    : 0;
  const bookedCalls = calls.filter(
    (call) => BOOKING_OUTCOMES.includes(call.bookingOutcome) || BOOKING_OUTCOMES.includes(call.status)
  ).length;
  const transferredCalls = calls.filter(
    (call) => call.status === 'transferred' || (call.transferOutcome && call.transferOutcome !== 'none')
  ).length;
  const sentiment = ['positive', 'neutral', 'negative'].reduce((result, key) => {
    result[key] = calls.filter((call) => call.sentiment === key).length;
    return result;
  }, {});
  const analyzedCalls = sentiment.positive + sentiment.neutral + sentiment.negative;

  return {
    timezone,
    rangeDays,
    totals: {
      calls: calls.length,
      callsChange: change(calls.length, previousCallCount),
      appointments: appointments.length,
      appointmentsChange: change(appointments.length, previousAppointmentCount),
      patients: totalPatients,
      newPatients,
      activeCalls: calls.filter((call) => ['active', 'ringing', 'queued'].includes(call.status)).length,
      callsToday: series[series.length - 1]?.calls || 0,
      appointmentsToday: todayAppointments.length,
      averageCallDuration,
      bookingRate: percent(bookedCalls, calls.length),
      transferredCalls,
      positiveRate: percent(sentiment.positive, analyzedCalls),
      cancelledAppointments: appointments.filter((item) => item.status === 'cancelled').length,
      aiBookings: appointments.filter((item) => item.source === 'phone').length
    },
    series,
    sentiment,
    outcomes: [
      { label: 'Booked', value: bookedCalls },
      { label: 'Transferred', value: transferredCalls },
      {
        label: 'Info only',
        value: calls.filter(
          (call) =>
            call.status === 'completed' &&
            !BOOKING_OUTCOMES.includes(call.bookingOutcome) &&
            (!call.transferOutcome || call.transferOutcome === 'none')
        ).length
      },
      { label: 'Failed / missed', value: calls.filter((call) => ['failed', 'missed'].includes(call.status)).length }
    ],
    recentCalls: calls.slice(0, 6),
    todayAppointments,
    upcomingAppointments
  };
};
