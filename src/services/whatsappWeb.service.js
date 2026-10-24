import makeWASocket, { BufferJSON, DisconnectReason, initAuthCreds, proto } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

import { env } from '../config/env.js';
import { Appointment } from '../models/appointment.model.js';
import { WhatsappWebAuth } from '../models/whatsappWebAuth.model.js';
import { logger } from '../utils/logger.js';
import { normalizePhoneNumber } from './twilio.service.js';

const SERIALIZE = (value) => JSON.stringify(value, BufferJSON.replacer);
const DESERIALIZE = (value) => JSON.parse(value, BufferJSON.reviver);
const READINESS_TIMEOUT_MS = 20000;

let socket = null;
let connectionState = 'disabled';
let qrDataUrl = '';
let lastError = '';
let connectedPhone = '';
let connectTask = null;
let reconnectTimer = null;
let readyListeners = new Set();

const authKey = (type, id) => `key:${type}:${id}`;

export const createMongoAuthState = async () => {
  const storedCreds = await WhatsappWebAuth.findById('creds').lean();
  const creds = storedCreds ? DESERIALIZE(storedCreds.payload) : initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const rows = await WhatsappWebAuth.find({ _id: { $in: ids.map((id) => authKey(type, id)) } }).lean();
          const result = Object.fromEntries(ids.map((id) => [id, null]));
          for (const row of rows) {
            const id = row._id.slice(`key:${type}:`.length);
            let value = DESERIALIZE(row.payload);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            result[id] = value;
          }
          return result;
        },
        set: async (data) => {
          const operations = [];
          for (const [type, entries] of Object.entries(data)) {
            for (const [id, value] of Object.entries(entries || {})) {
              const _id = authKey(type, id);
              operations.push(value == null
                ? { deleteOne: { filter: { _id } } }
                : { replaceOne: { filter: { _id }, replacement: { _id, payload: SERIALIZE(value) }, upsert: true } });
            }
          }
          if (operations.length) await WhatsappWebAuth.bulkWrite(operations);
        }
      }
    },
    saveCreds: async () => {
      await WhatsappWebAuth.replaceOne({ _id: 'creds' }, { _id: 'creds', payload: SERIALIZE(creds) }, { upsert: true });
    }
  };
};

const notifyReady = () => {
  for (const listener of readyListeners) listener();
  readyListeners = new Set();
};

const updateMessageAcknowledgement = async (updates) => {
  for (const { key, update } of updates) {
    if (!key?.fromMe || !key.id) continue;
    const status = update?.status >= proto.WebMessageInfo.Status.READ
      ? 'read'
      : update?.status >= proto.WebMessageInfo.Status.DELIVERY_ACK
        ? 'delivered'
        : null;
    if (!status) continue;
    const appointment = await Appointment.findOne({ whatsappMessageSid: key.id });
    if (!appointment || appointment.whatsappStatus === 'failed') continue;
    const rank = { sent: 1, delivered: 2, read: 3 };
    if ((rank[status] || 0) <= (rank[appointment.whatsappStatus] || 0)) continue;
    appointment.whatsappStatus = status;
    const log = appointment.notificationLogs?.find((entry) => entry.sid === key.id);
    if (log) log.status = status;
    await appointment.save();
  }
};

const scheduleReconnect = (delay = 3000) => {
  if (reconnectTimer || env.whatsappProvider !== 'web') return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startWhatsappWeb().catch((error) => logger.error(`WhatsApp Web reconnect failed: ${error.message}`));
  }, delay);
  reconnectTimer.unref?.();
};

export const startWhatsappWeb = async () => {
  if (env.whatsappProvider !== 'web') return;
  if (socket || connectTask) return connectTask;

  connectTask = (async () => {
    connectionState = 'connecting';
    qrDataUrl = '';
    const { state, saveCreds } = await createMongoAuthState();
    const currentSocket = makeWASocket({ auth: state, markOnlineOnConnect: false, syncFullHistory: false });
    socket = currentSocket;
    let credentialsWrite = Promise.resolve();

    currentSocket.ev.on('creds.update', () => {
      credentialsWrite = credentialsWrite.then(saveCreds).catch((error) => {
        lastError = `Could not save WhatsApp session: ${error.message}`;
        logger.error(lastError);
      });
    });
    currentSocket.ev.on('messages.update', (updates) => {
      updateMessageAcknowledgement(updates).catch((error) => logger.warn(`WhatsApp acknowledgement update failed: ${error.message}`));
    });

    currentSocket.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
      if (socket !== currentSocket) return;
      if (qr) {
        QRCode.toDataURL(qr, { margin: 2, width: 280 }).then((dataUrl) => {
          if (socket !== currentSocket || connectionState === 'connected') return;
          qrDataUrl = dataUrl;
          connectionState = 'awaiting_scan';
          lastError = '';
        }).catch((error) => {
          lastError = `Could not render WhatsApp QR code: ${error.message}`;
          logger.error(lastError);
        });
      }
      if (connection === 'open') {
        connectionState = 'connected';
        qrDataUrl = '';
        lastError = '';
        connectedPhone = currentSocket.user?.id?.split(':')[0] || '';
        notifyReady();
        logger.info('WhatsApp Web connected');
      }
      if (connection === 'close') {
        socket = null;
        qrDataUrl = '';
        connectedPhone = '';
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          connectionState = 'awaiting_scan';
          lastError = 'WhatsApp session was logged out. Scan the new QR code.';
          credentialsWrite.then(() => WhatsappWebAuth.deleteMany({}))
            .catch((error) => logger.error(`Could not clear logged-out WhatsApp session: ${error.message}`))
            .finally(() => scheduleReconnect());
        } else {
          connectionState = 'disconnected';
          lastError = lastDisconnect?.error?.message || 'WhatsApp Web connection closed';
          credentialsWrite.finally(() => scheduleReconnect());
        }
      }
    });
  })();

  try {
    await connectTask;
  } catch (error) {
    connectionState = 'disconnected';
    lastError = error.message;
    scheduleReconnect();
    throw error;
  } finally {
    connectTask = null;
  }
};

export const getWhatsappWebStatus = () => ({
  provider: env.whatsappProvider,
  state: env.whatsappProvider === 'web' ? connectionState : 'disabled',
  phone: connectedPhone,
  qrDataUrl: env.whatsappProvider === 'web' ? qrDataUrl : '',
  error: lastError
});

const waitUntilConnected = async () => {
  if (connectionState === 'connected' && socket) return socket;
  await startWhatsappWeb();
  if (connectionState === 'connected' && socket) return socket;
  await new Promise((resolve, reject) => {
    const onReady = () => { clearTimeout(timeout); resolve(); };
    const timeout = setTimeout(() => {
      readyListeners.delete(onReady);
      reject(new Error('WhatsApp Web is not connected. Scan the QR code in Settings → Integrations.'));
    }, READINESS_TIMEOUT_MS);
    readyListeners.add(onReady);
  });
  return socket;
};

export const sendWhatsappWebMessage = async ({ to, body, beforeSend }) => {
  const phone = normalizePhoneNumber(to);
  if (!/^\+\d{8,15}$/.test(phone)) throw new Error('A valid international WhatsApp number is required');
  if (!body?.trim()) throw new Error('WhatsApp message is empty');
  const activeSocket = await waitUntilConnected();
  const recipients = await activeSocket.onWhatsApp(phone.slice(1));
  if (!recipients?.[0]?.exists) throw new Error('The patient number is not registered on WhatsApp');
  if (beforeSend) await beforeSend();
  const result = await activeSocket.sendMessage(recipients[0].jid, { text: body });
  if (!result?.key?.id) throw new Error('WhatsApp Web did not accept the message');
  return {
    success: true,
    delivered: true,
    sid: result.key.id,
    status: 'sent',
    to: phone,
    body,
    usedTemplate: ''
  };
};
