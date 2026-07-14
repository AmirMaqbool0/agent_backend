import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';

import {
  createClinicSlots,
  resolveAvailabilityRange
} from './availability.js';

const clinicTimezone = 'Asia/Karachi';

const fullWeekSchedule = {
  sunday: { start: '09:00', end: '17:00' },
  monday: { start: '09:00', end: '17:00' },
  tuesday: { start: '09:00', end: '17:00' },
  wednesday: { start: '09:00', end: '17:00' },
  thursday: { start: '09:00', end: '17:00' },
  friday: { start: '09:00', end: '17:00' },
  saturday: { start: '09:00', end: '17:00' }
};

const config = {
  timezone: clinicTimezone,
  appointmentDurationMinutes: 30,
  workingHours: fullWeekSchedule
};

const toLocalTimes = (slots) =>
  slots.map((slot) =>
    DateTime.fromISO(slot.start, { setZone: true }).setZone(clinicTimezone).toFormat('HH:mm')
  );

test('today availability excludes past morning slots when current time is 2 PM', () => {
  const nowLocal = DateTime.fromISO('2026-06-02T14:00:00', { zone: clinicTimezone });
  const range = resolveAvailabilityRange({
    dateQuery: 'today',
    clinicTimezone,
    config,
    nowLocal
  });
  const slots = createClinicSlots({
    config,
    rangeStartUtc: range.rangeStartUtc,
    rangeEndUtc: range.rangeEndUtc,
    clinicTimezone,
    slotDurationMinutes: 30
  });
  const localTimes = toLocalTimes(slots);

  assert.equal(localTimes[0], '14:00');
  assert.ok(!localTimes.includes('09:00'));
  assert.ok(localTimes.every((time) => time >= '14:00'));
});

test('morning queries move to next day morning when morning has passed', () => {
  const nowLocal = DateTime.fromISO('2026-06-02T14:00:00', { zone: clinicTimezone });
  const range = resolveAvailabilityRange({
    dateQuery: 'morning',
    clinicTimezone,
    config,
    nowLocal
  });
  const slots = createClinicSlots({
    config,
    rangeStartUtc: range.rangeStartUtc,
    rangeEndUtc: range.rangeEndUtc,
    clinicTimezone,
    slotDurationMinutes: 30
  });
  const firstSlot = DateTime.fromISO(slots[0].start, { setZone: true }).setZone(clinicTimezone);

  assert.equal(firstSlot.toISODate(), '2026-06-03');
  assert.equal(firstSlot.toFormat('HH:mm'), '09:00');
});

test('today queries move to next clinic day when no time remains today', () => {
  const nowLocal = DateTime.fromISO('2026-06-02T17:30:00', { zone: clinicTimezone });
  const range = resolveAvailabilityRange({
    dateQuery: 'today',
    clinicTimezone,
    config,
    nowLocal
  });
  const slots = createClinicSlots({
    config,
    rangeStartUtc: range.rangeStartUtc,
    rangeEndUtc: range.rangeEndUtc,
    clinicTimezone,
    slotDurationMinutes: 30
  });
  const firstSlot = DateTime.fromISO(slots[0].start, { setZone: true }).setZone(clinicTimezone);

  assert.equal(firstSlot.toISODate(), '2026-06-03');
  assert.equal(firstSlot.toFormat('HH:mm'), '09:00');
});

test('afternoon queries move to next day afternoon when afternoon has passed', () => {
  const nowLocal = DateTime.fromISO('2026-06-02T17:30:00', { zone: clinicTimezone });
  const range = resolveAvailabilityRange({
    dateQuery: 'today afternoon',
    clinicTimezone,
    config,
    nowLocal
  });
  const slots = createClinicSlots({
    config,
    rangeStartUtc: range.rangeStartUtc,
    rangeEndUtc: range.rangeEndUtc,
    clinicTimezone,
    slotDurationMinutes: 30
  });
  const firstSlot = DateTime.fromISO(slots[0].start, { setZone: true }).setZone(clinicTimezone);

  assert.equal(firstSlot.toISODate(), '2026-06-03');
  assert.equal(firstSlot.toFormat('HH:mm'), '12:00');
});
