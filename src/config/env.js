import dotenv from 'dotenv';

dotenv.config();

const required = ['MONGODB_URI', 'JWT_SECRET'];
const googleCalendarAuthMode =
  process.env.GOOGLE_CALENDAR_AUTH_MODE ||
  (process.env.GOOGLE_CLIENT_ID
    ? 'oauth'
    : process.env.GOOGLE_CLIENT_EMAIL
      ? 'service_account'
      : 'disabled');

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

if (googleCalendarAuthMode === 'oauth') {
  const googleOauthRequired = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'GOOGLE_REFRESH_TOKEN',
    'GOOGLE_CALENDAR_ID'
  ];

  for (const key of googleOauthRequired) {
    if (!process.env[key]) {
      throw new Error(`Missing ${key} in environment variables`);
    }
  }
}

if (googleCalendarAuthMode === 'service_account') {
  const googleServiceAccountRequired = [
    'GOOGLE_CLIENT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
    'GOOGLE_CALENDAR_ID'
  ];

  for (const key of googleServiceAccountRequired) {
    if (!process.env[key]) {
      throw new Error(`Missing ${key} in environment variables`);
    }
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  logLevel: process.env.LOG_LEVEL || 'info',
  debugVapi: String(process.env.DEBUG_VAPI || 'false').toLowerCase() === 'true',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  openAiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  vapiApiKey: process.env.VAPI_API_KEY || '',
  vapiBaseUrl: process.env.VAPI_BASE_URL || 'https://api.vapi.ai',
  googleCalendarAuthMode,
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
  googleClientEmail: process.env.GOOGLE_CLIENT_EMAIL || '',
  googlePrivateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  googleCalendarId: (process.env.GOOGLE_CALENDAR_ID || '').trim(),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioWhatsappFrom: process.env.TWILIO_WHATSAPP_FROM || '',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173'
};
