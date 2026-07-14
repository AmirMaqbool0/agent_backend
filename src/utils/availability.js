import { DateTime } from 'luxon';

import { ApiError } from './apiError.js';

export const DEFAULT_CLINIC_TIMEZONE = 'Asia/Karachi';
export const DEFAULT_CLINIC_DAY_START_HOUR = 9;
export const DEFAULT_CLINIC_DAY_END_HOUR = 17;
export const DEFAULT_SLOT_DURATION_MINUTES = 30;

const AVAILABILITY_WEEKDAYS = {
  sunday: 7,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

const maxDateTime = (left, right) => (left.toMillis() >= right.toMillis() ? left : right);
const minDateTime = (left, right) => (left.toMillis() <= right.toMillis() ? left : right);

export const parseUtcDateTimeOrThrow = (value, label) => {
  const parsed = DateTime.fromISO(value, { setZone: true }).toUTC();

  if (!parsed.isValid) {
    throw new ApiError(400, `${label} must be a valid ISO date`);
  }

  return parsed;
};

export const parseHourMinute = (value, fallbackHour) => {
  if (!value || typeof value !== 'string' || !value.includes(':')) {
    return { hour: fallbackHour, minute: 0 };
  }

  const [rawHour, rawMinute] = value.split(':');
  const hour = Number(rawHour);
  const minute = Number(rawMinute);

  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return { hour: fallbackHour, minute: 0 };
  }

  return { hour, minute };
};

export const getClinicHoursForDay = ({ config, localDay }) => {
  const weekdayKey = localDay.toFormat('cccc').toLowerCase();
  const dayConfig = config.workingHours?.[weekdayKey] || {};
  const startParts = parseHourMinute(dayConfig.start, DEFAULT_CLINIC_DAY_START_HOUR);
  const endParts = parseHourMinute(dayConfig.end, DEFAULT_CLINIC_DAY_END_HOUR);

  return {
    startHour: startParts.hour,
    startMinute: startParts.minute,
    endHour: endParts.hour,
    endMinute: endParts.minute
  };
};

const getSegmentFromQuery = (normalizedQuery) => {
  if (normalizedQuery.includes('morning')) {
    return 'morning';
  }

  if (normalizedQuery.includes('afternoon')) {
    return 'afternoon';
  }

  return 'full';
};

const getNextWeekday = ({ currentDateTime, targetWeekday, includeToday = false }) => {
  let daysUntilTarget = (targetWeekday - currentDateTime.weekday + 7) % 7;

  if (!includeToday && daysUntilTarget === 0) {
    daysUntilTarget = 7;
  }

  return currentDateTime.plus({ days: daysUntilTarget }).startOf('day');
};

const buildDaySegmentRange = ({ config, localDay, segment }) => {
  const clinicHours = getClinicHoursForDay({ config, localDay });
  const clinicStartLocal = localDay.set({
    hour: clinicHours.startHour,
    minute: clinicHours.startMinute,
    second: 0,
    millisecond: 0
  });
  const clinicEndLocal = localDay.set({
    hour: clinicHours.endHour,
    minute: clinicHours.endMinute,
    second: 0,
    millisecond: 0
  });

  let rangeStartLocal = clinicStartLocal;
  let rangeEndLocal = clinicEndLocal;

  if (segment === 'morning') {
    rangeEndLocal = minDateTime(
      clinicEndLocal,
      localDay.set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
    );
  }

  if (segment === 'afternoon') {
    rangeStartLocal = maxDateTime(
      clinicStartLocal,
      localDay.set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
    );
  }

  if (rangeEndLocal <= rangeStartLocal) {
    return null;
  }

  return {
    startLocal: rangeStartLocal,
    endLocal: rangeEndLocal
  };
};

const shiftToFutureRangeIfNeeded = ({
  config,
  localDay,
  segment,
  nowLocal,
  rollToNextDayIfPast
}) => {
  let targetDay = localDay.startOf('day');
  let range = buildDaySegmentRange({ config, localDay: targetDay, segment });

  if (!range) {
    throw new ApiError(400, 'Clinic hours are invalid for the requested day');
  }

  if (targetDay.hasSame(nowLocal, 'day') && range.endLocal <= nowLocal && rollToNextDayIfPast) {
    targetDay = targetDay.plus({ days: 1 });
    range = buildDaySegmentRange({ config, localDay: targetDay, segment });
  }

  return {
    targetDayLocal: targetDay,
    range
  };
};

const normalizeRangeForFuture = ({ range, nowLocal }) => {
  if (range.startLocal.hasSame(nowLocal, 'day')) {
    return {
      startLocal: maxDateTime(range.startLocal, nowLocal),
      endLocal: range.endLocal
    };
  }

  return range;
};

const toUtcRange = ({ rangeLocal }) => ({
  rangeStartUtc: rangeLocal.startLocal.toUTC(),
  rangeEndUtc: rangeLocal.endLocal.toUTC()
});

const resolveDateOnlyQueryRange = ({
  normalizedQuery,
  clinicTimezone,
  config,
  nowLocal
}) => {
  const segment = getSegmentFromQuery(normalizedQuery);

  if (
    normalizedQuery === 'today' ||
    normalizedQuery.includes('today') ||
    normalizedQuery === 'this morning' ||
    normalizedQuery === 'this afternoon'
  ) {
    const { targetDayLocal, range } = shiftToFutureRangeIfNeeded({
      config,
      localDay: nowLocal.startOf('day'),
      segment,
      nowLocal,
      rollToNextDayIfPast: true
    });

    return {
      ...toUtcRange({ rangeLocal: normalizeRangeForFuture({ range, nowLocal }) }),
      fallbackStrategy: {
        type: 'next-day',
        segment
      },
      requestedDayLocal: targetDayLocal
    };
  }

  if (normalizedQuery === 'tomorrow' || normalizedQuery.includes('tomorrow')) {
    const range = buildDaySegmentRange({
      config,
      localDay: nowLocal.plus({ days: 1 }).startOf('day'),
      segment
    });

    return {
      ...toUtcRange({ rangeLocal: range }),
      fallbackStrategy: null,
      requestedDayLocal: nowLocal.plus({ days: 1 }).startOf('day')
    };
  }

  if (normalizedQuery === 'morning' || normalizedQuery === 'afternoon') {
    const { targetDayLocal, range } = shiftToFutureRangeIfNeeded({
      config,
      localDay: nowLocal.startOf('day'),
      segment,
      nowLocal,
      rollToNextDayIfPast: true
    });

    return {
      ...toUtcRange({ rangeLocal: normalizeRangeForFuture({ range, nowLocal }) }),
      fallbackStrategy: {
        type: 'next-day',
        segment
      },
      requestedDayLocal: targetDayLocal
    };
  }

  return null;
};

const resolveWeekdayQueryRange = ({
  normalizedQuery,
  clinicTimezone,
  config,
  nowLocal
}) => {
  const matchedWeekday = Object.entries(AVAILABILITY_WEEKDAYS).find(([weekday]) =>
    normalizedQuery.includes(weekday)
  );

  if (!matchedWeekday) {
    return null;
  }

  const [, weekdayNumber] = matchedWeekday;
  const segment = getSegmentFromQuery(normalizedQuery);
  const includeToday = nowLocal.weekday === weekdayNumber && !normalizedQuery.startsWith('next ');
  const targetDay = getNextWeekday({
    currentDateTime: nowLocal,
    targetWeekday: weekdayNumber,
    includeToday
  });
  const { targetDayLocal, range } = shiftToFutureRangeIfNeeded({
    config,
    localDay: targetDay,
    segment,
    nowLocal,
    rollToNextDayIfPast: true
  });

  return {
    ...toUtcRange({ rangeLocal: normalizeRangeForFuture({ range, nowLocal }) }),
    fallbackStrategy:
      targetDayLocal.hasSame(nowLocal, 'day')
        ? {
            type: 'next-day',
            segment
          }
        : null,
    requestedDayLocal: targetDayLocal
  };
};

const resolveNamedDateRange = ({
  normalizedQuery,
  clinicTimezone,
  config,
  nowLocal
}) => {
  const parsedDateFormats = ['yyyy-MM-dd', 'LLLL d', 'LLLL d yyyy', 'd LLLL', 'd LLLL yyyy'];
  const segment = getSegmentFromQuery(normalizedQuery);

  for (const format of parsedDateFormats) {
    const parsed = DateTime.fromFormat(normalizedQuery, format, { zone: clinicTimezone });

    if (parsed.isValid) {
      const targetDay =
        format.includes('yyyy')
          ? parsed.startOf('day')
          : parsed.set({ year: nowLocal.year }).startOf('day');
      const { targetDayLocal, range } = shiftToFutureRangeIfNeeded({
        config,
        localDay: targetDay,
        segment,
        nowLocal,
        rollToNextDayIfPast: true
      });

      return {
        ...toUtcRange({ rangeLocal: normalizeRangeForFuture({ range, nowLocal }) }),
        fallbackStrategy:
          targetDayLocal.hasSame(nowLocal, 'day')
            ? {
                type: 'next-day',
                segment
              }
            : null,
        requestedDayLocal: targetDayLocal
      };
    }
  }

  return null;
};

export const resolveDateQueryRange = ({
  dateQuery,
  clinicTimezone,
  config,
  nowLocal = DateTime.now().setZone(clinicTimezone)
}) => {
  const normalizedQuery = dateQuery?.trim().toLowerCase();

  if (!normalizedQuery) {
    return null;
  }

  const directRange =
    resolveDateOnlyQueryRange({
      normalizedQuery,
      clinicTimezone,
      config,
      nowLocal
    }) ||
    resolveWeekdayQueryRange({
      normalizedQuery,
      clinicTimezone,
      config,
      nowLocal
    }) ||
    resolveNamedDateRange({
      normalizedQuery,
      clinicTimezone,
      config,
      nowLocal
    });

  if (directRange) {
    return directRange;
  }

  if (normalizedQuery === 'next week') {
    const targetStart = nowLocal.plus({ days: 1 }).startOf('day');
    return {
      rangeStartUtc: targetStart.toUTC(),
      rangeEndUtc: targetStart.plus({ days: 6 }).endOf('day').toUTC(),
      fallbackStrategy: null,
      requestedDayLocal: targetStart
    };
  }

  if (normalizedQuery === 'earliest available') {
    return {
      rangeStartUtc: nowLocal.toUTC(),
      rangeEndUtc: nowLocal.plus({ days: 13 }).endOf('day').toUTC(),
      fallbackStrategy: null,
      requestedDayLocal: nowLocal.startOf('day')
    };
  }

  throw new ApiError(400, `Unsupported date query: ${dateQuery}`);
};

export const resolveAvailabilityRange = ({
  start,
  end,
  dateQuery,
  clinicTimezone,
  config,
  nowLocal = DateTime.now().setZone(clinicTimezone)
}) => {
  if (dateQuery) {
    return resolveDateQueryRange({
      dateQuery,
      clinicTimezone,
      config,
      nowLocal
    });
  }

  const parsedStartUtc = parseUtcDateTimeOrThrow(start, 'Start date');
  const parsedEndUtc = parseUtcDateTimeOrThrow(end, 'End date');
  const normalizedStartLocal = parsedStartUtc.setZone(clinicTimezone).startOf('day');
  const sameUtcCalendarDay = parsedStartUtc.toISODate() === parsedEndUtc.toISODate();
  const normalizedEndLocal = sameUtcCalendarDay
    ? normalizedStartLocal.endOf('day')
    : parsedEndUtc.setZone(clinicTimezone).endOf('day');
  const requestedDayLocal = normalizedStartLocal.startOf('day');
  const effectiveStartUtc = maxDateTime(parsedStartUtc, nowLocal.toUTC());

  if (requestedDayLocal.hasSame(nowLocal, 'day') && effectiveStartUtc >= normalizedEndLocal.toUTC()) {
    const nextDayRange = buildDaySegmentRange({
      config,
      localDay: requestedDayLocal.plus({ days: 1 }),
      segment: 'full'
    });

    return {
      ...toUtcRange({ rangeLocal: nextDayRange }),
      fallbackStrategy: {
        type: 'next-day',
        segment: 'full'
      },
      requestedDayLocal: requestedDayLocal.plus({ days: 1 })
    };
  }

  return {
    rangeStartUtc: effectiveStartUtc,
    rangeEndUtc: normalizedEndLocal.toUTC(),
    fallbackStrategy:
      requestedDayLocal.hasSame(nowLocal, 'day')
        ? {
            type: 'next-day',
            segment: 'full'
          }
        : null,
    requestedDayLocal
  };
};

export const buildFallbackAvailabilityRange = ({
  config,
  clinicTimezone,
  fallbackStrategy,
  requestedDayLocal
}) => {
  if (!fallbackStrategy || fallbackStrategy.type !== 'next-day') {
    return null;
  }

  const nextDay = requestedDayLocal.plus({ days: 1 }).setZone(clinicTimezone).startOf('day');
  const nextDayRange = buildDaySegmentRange({
    config,
    localDay: nextDay,
    segment: fallbackStrategy.segment
  });

  if (!nextDayRange) {
    return null;
  }

  return {
    ...toUtcRange({ rangeLocal: nextDayRange }),
    fallbackStrategy: null,
    requestedDayLocal: nextDay
  };
};

export const createClinicSlots = ({
  config,
  rangeStartUtc,
  rangeEndUtc,
  clinicTimezone,
  slotDurationMinutes
}) => {
  const slots = [];
  const localStart = rangeStartUtc.setZone(clinicTimezone);
  const localEnd = rangeEndUtc.setZone(clinicTimezone);

  for (
    let localDay = localStart.startOf('day');
    localDay <= localEnd.startOf('day');
    localDay = localDay.plus({ days: 1 })
  ) {
    const clinicHours = getClinicHoursForDay({ config, localDay });
    let slotStartLocal = localDay.set({
      hour: clinicHours.startHour,
      minute: clinicHours.startMinute,
      second: 0,
      millisecond: 0
    });
    const clinicDayEndLocal = localDay.set({
      hour: clinicHours.endHour,
      minute: clinicHours.endMinute,
      second: 0,
      millisecond: 0
    });

    while (slotStartLocal < clinicDayEndLocal) {
      const slotEndLocal = slotStartLocal.plus({ minutes: slotDurationMinutes });

      if (slotEndLocal > clinicDayEndLocal) {
        break;
      }

      const slotStartUtc = slotStartLocal.toUTC();
      const slotEndUtc = slotEndLocal.toUTC();

      if (slotStartUtc >= rangeStartUtc && slotEndUtc <= rangeEndUtc) {
        slots.push({
          start: slotStartUtc.toISO(),
          end: slotEndUtc.toISO()
        });
      }

      slotStartLocal = slotEndLocal;
    }
  }

  return slots;
};
