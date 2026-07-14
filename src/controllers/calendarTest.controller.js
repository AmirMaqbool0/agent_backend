import { createTestCalendarEvent } from '../services/googleCalendar.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createCalendarTestEvent = asyncHandler(async (_req, res) => {
  const event = await createTestCalendarEvent();

  res.status(200).json({
    success: true,
    eventId: event.id,
    htmlLink: event.htmlLink
  });
});
