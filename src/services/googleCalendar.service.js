import { google } from 'googleapis';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/apiError.js';

const logCalendarContext = (operationName) => {
  console.log('GOOGLE_CALENDAR_AUTH_MODE =', env.googleCalendarAuthMode);
  console.log('GOOGLE_CALENDAR_ID =', env.googleCalendarId);
  console.log('Calendar ID Used:', env.googleCalendarId);
  logger.info(
    `${operationName} using Google Calendar auth mode ${env.googleCalendarAuthMode} and calendar ID ${env.googleCalendarId}`
  );
};

const getOAuthCalendarClient = async () => {
  logCalendarContext('google-calendar-oauth-client');
  const oauth2Client = new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    env.googleRedirectUri
  );

  oauth2Client.setCredentials({
    refresh_token: env.googleRefreshToken
  });

  try {
    await oauth2Client.getAccessToken();
  } catch (error) {
    logger.error(`Google Calendar token refresh failed: ${error.message}`);
    throw new ApiError(500, 'Google Calendar token refresh failed');
  }

  return google.calendar({
    version: 'v3',
    auth: oauth2Client
  });
};

const getServiceAccountCalendarClient = () => {
  logCalendarContext('google-calendar-service-account-client');
  const jwtClient = new google.auth.JWT({
    email: env.googleClientEmail,
    key: env.googlePrivateKey,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });

  return google.calendar({
    version: 'v3',
    auth: jwtClient
  });
};

const getCalendarClient = async () => {
  if (env.googleCalendarAuthMode === 'oauth') {
    return getOAuthCalendarClient();
  }

  if (env.googleCalendarAuthMode === 'service_account') {
    if (env.googleCalendarId === 'primary') {
      logger.warn(
        'Google Calendar is using service_account mode with calendarId=primary; events may be created in the service account calendar instead of the clinic user calendar.'
      );
    }

    logger.warn(
      `If using service_account mode, share calendar ${env.googleCalendarId} with ${env.googleClientEmail} and grant Make changes to events access.`
    );

    return getServiceAccountCalendarClient();
  }

  logger.warn('Google Calendar integration is disabled');
  return null;
};

export const listCalendarEvents = async (timeMin, timeMax) => {
  const client = await getCalendarClient();
  if (!client) {
    return [];
  }

  logCalendarContext('google-calendar-list');

  try {
    const response = await client.events.list({
      calendarId: env.googleCalendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime'
    });

    return response.data.items || [];
  } catch (error) {
    logger.error(`Google Calendar list failed: ${error.message}`);
    throw error;
  }
};

export const createCalendarEvent = async ({
  summary,
  description,
  start,
  end
}) => {
  const client = await getCalendarClient();
  if (!client) {
    throw new ApiError(500, 'Google Calendar client is not configured');
  }

  logCalendarContext('google-calendar-create');

  const payload = {
    calendarId: env.googleCalendarId,
    requestBody: {
      summary,
      description,
      start: { dateTime: start },
      end: { dateTime: end }
    }
  };

  console.log('Creating Google Calendar event...');
  console.log('Google Calendar payload:', payload);

  try {
    const response = await client.events.insert(payload);
    console.log('Google Calendar event created:', response.data);
    return response.data;
  } catch (error) {
    console.error('Google Calendar error:', error);
    logger.error(`Google Calendar creation failed: ${error.message}`);
    throw error;
  }
};

export const createTestCalendarEvent = async () => {
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  return createCalendarEvent({
    summary: 'Test Appointment Event',
    description: 'Calendar integration verification event',
    start: start.toISOString(),
    end: end.toISOString()
  });
};

export const updateCalendarEvent = async (eventId, updates) => {
  const client = await getCalendarClient();
  if (!client || !eventId) {
    throw new ApiError(500, 'Google Calendar client or event id is missing');
  }

  logCalendarContext('google-calendar-update');
  console.log('Updating Google Calendar event:', {
    eventId,
    updates
  });

  try {
    const response = await client.events.patch({
      calendarId: env.googleCalendarId,
      eventId,
      requestBody: updates
    });

    console.log('Google Calendar patch success:', response.data);
    return response.data;
  } catch (error) {
    console.error('Google Calendar patch failure:', error);
    logger.error(`Google Calendar update failed: ${error.message}`);
    throw error;
  }
};

export const cancelCalendarEvent = async (eventId) => {
  const client = await getCalendarClient();
  if (!client || !eventId) {
    throw new ApiError(500, 'Google Calendar client or event id is missing');
  }

  logCalendarContext('google-calendar-cancel');

  try {
    await client.events.delete({
      calendarId: env.googleCalendarId,
      eventId
    });

    return { success: true };
  } catch (error) {
    if (error?.response?.status === 410 || error?.code === 410) {
      logger.warn(`Google Calendar event ${eventId} was already deleted`);
      return { success: true, alreadyDeleted: true };
    }

    logger.error(`Google Calendar cancellation failed: ${error.message}`);
    throw error;
  }
};
