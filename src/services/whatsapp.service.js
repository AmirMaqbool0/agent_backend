import { env } from '../config/env.js';
import { sendWhatsappWebMessage } from './whatsappWeb.service.js';
import { sendWhatsappMessage as sendTwilioWhatsappMessage } from './twilio.service.js';

export const sendWhatsappMessage = (message) =>
  env.whatsappProvider === 'web'
    ? sendWhatsappWebMessage(message)
    : sendTwilioWhatsappMessage(message);
