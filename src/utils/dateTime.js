import { DateTime } from 'luxon';

import { ApiError } from './apiError.js';

export const DEFAULT_APPOINTMENT_TIMEZONE = 'Asia/Karachi';

const WEEKDAY_MAP = {
  sunday: 7,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

const parseTimeParts = (rawValue) => {
  if (!rawValue) {
    return null;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  const timeMatch = normalizedValue.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);

  if (!timeMatch) {
    return null;
  }

  let [, rawHour, rawMinute = '0', meridiem = ''] = timeMatch;
  let hour = Number(rawHour);
  const minute = Number(rawMinute);

  if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) {
    return null;
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }

    if (meridiem === 'pm' && hour !== 12) {
      hour += 12;
    }

    if (meridiem === 'am' && hour === 12) {
      hour = 0;
    }
  } else if (hour > 23) {
    return null;
  }

  return { hour, minute };
};

const buildLocalDateTime = ({ baseDate, timeParts }) => {
  if (!baseDate?.isValid || !timeParts) {
    return null;
  }

  return baseDate.set({
    hour: timeParts.hour,
    minute: timeParts.minute,
    second: 0,
    millisecond: 0
  });
};

const parseSlashDateTime = (value, timezone) => {
  const slashMatch = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\sT-]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)$/i
  );

  if (!slashMatch) {
    return null;
  }

  const [, firstPart, secondPart, yearPart, hourPart, minutePart = '0', meridiem = ''] =
    slashMatch;
  const first = Number(firstPart);
  const second = Number(secondPart);
  const year = Number(yearPart);
  const timeParts = parseTimeParts(
    `${hourPart}${minutePart ? `:${minutePart}` : ''}${meridiem ? ` ${meridiem}` : ''}`
  );

  if (!timeParts) {
    return null;
  }

  let day = first;
  let month = second;

  if (first <= 12 && second > 12) {
    month = first;
    day = second;
  }

  const parsed = DateTime.fromObject(
    {
      year,
      month,
      day,
      hour: timeParts.hour,
      minute: timeParts.minute,
      second: 0,
      millisecond: 0
    },
    { zone: timezone }
  );

  return parsed.isValid ? parsed : null;
};

const parseNaturalLanguageDateTime = (value, timezone) => {
  const normalizedValue = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const now = DateTime.now().setZone(timezone);

  const relativeMatch = normalizedValue.match(/^(today|tomorrow)(?:\s+(?:at\s+)?)?(.+)?$/);
  if (relativeMatch) {
    const [, dayKeyword, rawTime = ''] = relativeMatch;
    const baseDate =
      dayKeyword === 'tomorrow' ? now.plus({ days: 1 }).startOf('day') : now.startOf('day');
    const timeParts = parseTimeParts(rawTime);
    return buildLocalDateTime({ baseDate, timeParts });
  }

  const weekdayMatch = normalizedValue.match(
    /^(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+(?:at\s+)?)?(.+)?$/
  );

  if (weekdayMatch) {
    const [, hasNextPrefix, weekdayName, rawTime = ''] = weekdayMatch;
    const targetWeekday = WEEKDAY_MAP[weekdayName];
    let daysUntilTarget = (targetWeekday - now.weekday + 7) % 7;

    if (daysUntilTarget === 0 || hasNextPrefix) {
      daysUntilTarget = daysUntilTarget || 7;
    }

    const baseDate = now.plus({ days: daysUntilTarget }).startOf('day');
    const timeParts = parseTimeParts(rawTime);
    return buildLocalDateTime({ baseDate, timeParts });
  }

  return null;
};

const parseWithFormats = (value, timezone) => {
  const formats = [
    "yyyy-MM-dd'T'HH:mm",
    'yyyy-MM-dd HH:mm',
    'yyyy/MM/dd HH:mm',
    'LLLL d, yyyy h:mm a',
    'LLLL d yyyy h:mm a',
    'LLL d, yyyy h:mm a',
    'LLL d yyyy h:mm a'
  ];

  for (const format of formats) {
    const parsed = DateTime.fromFormat(value, format, { zone: timezone });

    if (parsed.isValid) {
      return parsed;
    }
  }

  return null;
};

export const parseAppointmentDateToDate = (
  value,
  { timezone = DEFAULT_APPOINTMENT_TIMEZONE, label = 'Appointment date' } = {}
) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.toISOString());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = DateTime.fromMillis(value, { zone: 'utc' });

    if (parsed.isValid) {
      return parsed.toUTC().toJSDate();
    }
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, `${label} must be a valid date and time`);
  }

  const trimmedValue = value.trim();

  const localIsoMatch = trimmedValue.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  if (localIsoMatch) {
    const parsed = DateTime.fromFormat(trimmedValue, "yyyy-MM-dd'T'HH:mm", { zone: timezone });

    if (parsed.isValid) {
      return parsed.toUTC().toJSDate();
    }
  }

  const explicitIsoCandidate = DateTime.fromISO(trimmedValue, { setZone: true });
  if (explicitIsoCandidate.isValid) {
    return explicitIsoCandidate.toUTC().toJSDate();
  }

  const slashDateCandidate = parseSlashDateTime(trimmedValue, timezone);
  if (slashDateCandidate?.isValid) {
    return slashDateCandidate.toUTC().toJSDate();
  }

  const naturalLanguageCandidate = parseNaturalLanguageDateTime(trimmedValue, timezone);
  if (naturalLanguageCandidate?.isValid) {
    return naturalLanguageCandidate.toUTC().toJSDate();
  }

  const formattedCandidate = parseWithFormats(trimmedValue, timezone);
  if (formattedCandidate?.isValid) {
    return formattedCandidate.toUTC().toJSDate();
  }

  const fallbackDate = new Date(trimmedValue);
  if (!Number.isNaN(fallbackDate.getTime())) {
    return fallbackDate;
  }

  throw new ApiError(
    400,
    `${label} must be a valid ISO date, slash date, or natural-language appointment time`
  );
};

export const parseAppointmentDateToIso = (value, options) =>
  parseAppointmentDateToDate(value, options).toISOString();
