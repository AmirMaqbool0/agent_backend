import crypto from 'node:crypto';

import { env } from '../config/env.js';

const ttlSeconds = 2 * 60 * 60;

const signatureFor = (id, expires) =>
  crypto.createHmac('sha256', env.jwtSecret).update(`${id}:${expires}`).digest('hex');

export const signedRecordingUrl = (callLog, baseUrl) => {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const id = String(callLog._id);
  const signature = signatureFor(id, expires);
  return `${baseUrl}/api/calls/${encodeURIComponent(id)}/recording?expires=${expires}&signature=${signature}`;
};

export const isValidRecordingSignature = (id, expiresValue, signatureValue) => {
  const expires = Number(expiresValue);
  if (!Number.isSafeInteger(expires) || expires < Date.now() / 1000 ||
    typeof signatureValue !== 'string' || !/^[a-f0-9]{64}$/.test(signatureValue)) return false;

  const expected = Buffer.from(signatureFor(id, expires), 'hex');
  const provided = Buffer.from(signatureValue, 'hex');
  return crypto.timingSafeEqual(expected, provided);
};
