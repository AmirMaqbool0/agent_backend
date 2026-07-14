import { Appointment } from '../models/appointment.model.js';
import { CallLog } from '../models/callLog.model.js';
import { createAssistantTransfer } from './vapi.service.js';
import { summarizeTranscript } from './openai.service.js';

const isTerminalEventSeen = (callLog) =>
  ['hang', 'call-ended', 'end-of-call-report'].some((eventType) =>
    (callLog.receivedEventTypes || []).includes(eventType)
  );

const buildTranscriptFromEntries = (entries = []) =>
  entries
    .map((entry) => `${entry.speaker}: ${entry.text}`)
    .join('\n');

const normalizeCallLogForDashboard = async (callLog) => {
  const updates = {};
  const currentStatus = callLog.status || 'received';

  if (
    ['received', 'queued', 'ringing', 'active'].includes(currentStatus) &&
    (callLog.endedAt || callLog.durationSeconds > 0 || isTerminalEventSeen(callLog))
  ) {
    updates.status = callLog.providerStatus === 'failed' ? 'failed' : 'completed';
  }

  if (!callLog.transcript && Array.isArray(callLog.transcriptEntries) && callLog.transcriptEntries.length) {
    updates.transcript = buildTranscriptFromEntries(callLog.transcriptEntries);
  }

  if (Object.keys(updates).length) {
    Object.assign(callLog, updates);
    await callLog.save();
  }

  return callLog;
};

export const listCallLogs = async () => {
  const callLogs = await CallLog.find().populate({
    path: 'appointment',
    populate: { path: 'patient' }
  }).sort({ startedAt: -1, createdAt: -1 });

  return Promise.all(callLogs.map((callLog) => normalizeCallLogForDashboard(callLog)));
};

export const processVapiWebhook = async (payload) => {
  const transcript = payload.transcript || payload.message?.transcript || '';
  const summary = await summarizeTranscript(transcript);

  const callLog = await CallLog.findOneAndUpdate(
    { callSid: payload.call?.id || payload.callSid || payload.id },
    {
      callerName: payload.customer?.name || payload.callerName || '',
      phone: payload.customer?.number || payload.phoneNumber || 'unknown',
      callSid: payload.call?.id || payload.callSid || payload.id || '',
      status: payload.urgent ? 'urgent' : payload.appointmentBooked ? 'booked' : 'received',
      transcript,
      summary,
      metadata: payload
    },
    {
      upsert: true,
      new: true
    }
  );

  if (payload.urgent && payload.transferNumber) {
    await createAssistantTransfer({
      callId: callLog.callSid,
      destination: payload.transferNumber
    });

    callLog.status = 'transferred';
    await callLog.save();
  }

  if (payload.appointmentId) {
    const appointment = await Appointment.findById(payload.appointmentId);
    if (appointment) {
      callLog.appointment = appointment._id;
      await callLog.save();
    }
  }

  return callLog;
};
