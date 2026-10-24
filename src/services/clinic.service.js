import { env } from '../config/env.js';
import { ClinicConfig } from '../models/clinicConfig.model.js';
import { getWhatsappWebStatus } from './whatsappWeb.service.js';

const EDITABLE_FIELDS = [
  'clinicName',
  'timezone',
  'clinicPhone',
  'address',
  'workingHours',
  'emergencyTransferNumber',
  'appointmentDurationMinutes',
  'whatsappEnabled',
  'confirmationsEnabled',
  'remindersEnabled',
  'alertsEnabled',
  'assistantPersonality',
  'aiLanguage',
  'responseTone',
  'escalationRules'
];

const WEEK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Older installs stored "UTC" as a placeholder; treat it as "not configured" and use the clinic default.
export const resolveClinicTimezone = (config) =>
  config?.timezone && config.timezone !== 'UTC' ? config.timezone : env.defaultClinicTimezone;

export const formatClinicDateTime = (value, timezone) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone
  }).format(new Date(value));

export const formatClinicDate = (value, timezone) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone }).format(
    new Date(value)
  );

export const formatClinicTime = (value, timezone) =>
  new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(value));

export const getClinicConfig = async () => {
  let config = await ClinicConfig.findOne();

  if (!config) {
    config = await ClinicConfig.create({
      clinicName: 'Clinic Reception',
      timezone: env.defaultClinicTimezone,
      workingHours: {
        monday: { start: '09:00', end: '17:00' },
        tuesday: { start: '09:00', end: '17:00' },
        wednesday: { start: '09:00', end: '17:00' },
        thursday: { start: '09:00', end: '17:00' },
        friday: { start: '09:00', end: '17:00' },
        saturday: { start: '10:00', end: '14:00' },
        sunday: { start: '', end: '' }
      }
    });
  }

  return config;
};

const sanitizeWorkingHours = (workingHours = {}) =>
  WEEK_DAYS.reduce((result, day) => {
    const hours = workingHours[day] || {};
    result[day] = {
      start: typeof hours.start === 'string' ? hours.start : '',
      end: typeof hours.end === 'string' ? hours.end : ''
    };
    return result;
  }, {});

export const updateClinicConfig = async (payload) => {
  const config = await getClinicConfig();

  for (const field of EDITABLE_FIELDS) {
    if (payload[field] === undefined) {
      continue;
    }

    config[field] = field === 'workingHours' ? sanitizeWorkingHours(payload[field]) : payload[field];
  }

  await config.save();
  return config;
};

// Only reports whether each provider has credentials; never returns the secrets themselves.
export const getIntegrationStatus = () => {
  const whatsappWeb = getWhatsappWebStatus();
  return {
  openai: {
    configured: Boolean(env.openAiApiKey),
    detail: env.openAiApiKey ? `Model ${env.openAiModel}` : 'OPENAI_API_KEY is not set'
  },
  vapi: {
    configured: Boolean(env.vapiApiKey),
    detail: env.vapiWebhookSecret
      ? 'Webhook secured with VAPI_WEBHOOK_SECRET'
      : 'Webhook is not protected by a secret yet'
  },
  googleCalendar: {
    configured: env.googleCalendarAuthMode !== 'disabled',
    detail:
      env.googleCalendarAuthMode === 'disabled'
        ? 'Calendar sync is disabled'
        : `${env.googleCalendarAuthMode === 'oauth' ? 'OAuth' : 'Service account'} connection`
  },
  twilio: {
    configured: env.whatsappProvider === 'twilio' && Boolean(env.twilioAccountSid && env.twilioAuthToken && env.twilioWhatsappFrom),
    detail: env.whatsappProvider === 'twilio' ? (env.twilioWhatsappFrom ? 'WhatsApp sender configured' : 'Twilio WhatsApp sender is not set') : 'Not used; WhatsApp Web is selected'
  },
  whatsappWeb: {
    configured: whatsappWeb.state === 'connected',
    detail: whatsappWeb.state === 'connected'
      ? `Connected as +${whatsappWeb.phone}`
      : `Status: ${whatsappWeb.state.replace('_', ' ')}`
  }
  };
};
