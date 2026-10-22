 import axios from 'axios';

import { env } from '../config/env.js';
import { CallLog } from '../models/callLog.model.js';
import { getAvailability, createAppointment, cancelAppointment, rescheduleAppointment } from './appointment.service.js';
import { answerFaq } from './faq.service.js';
import { analyzeSentiment, summarizeTranscript } from './openai.service.js';
import { getClinicConfig } from './clinic.service.js';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/apiError.js';
import { parseAppointmentDateToIso } from '../utils/dateTime.js';
import { withRetry } from '../utils/retry.js';

const vapiClient = axios.create({
  baseURL: env.vapiBaseUrl,
  headers: env.vapiApiKey
    ? {
        Authorization: `Bearer ${env.vapiApiKey}`,
        'Content-Type': 'application/json'
      }
    : {
        'Content-Type': 'application/json'
      }
});

export const createAssistantTransfer = async ({ callId, destination }) => {
  if (!env.vapiApiKey) {
    logger.warn('Vapi API key missing, skipping call transfer');
    return null;
  }

  const response = await vapiClient.post(`/call/${callId}/transfer`, {
    destination
  });

  return response.data;
};

const getMessagePayload = (payload) => payload.message || payload;

const getMessageType = (payload) => getMessagePayload(payload).type || payload.type;

const getCallDetails = (payload) => getMessagePayload(payload).call || payload.call || {};

const getCustomerDetails = (payload) =>
  getMessagePayload(payload).customer ||
  getCallDetails(payload).customer ||
  payload.customer ||
  {};

const getCallIdentifier = (payload) => {
  const call = getCallDetails(payload);
  const message = getMessagePayload(payload);

  return (
    call.id ||
    message.callId ||
    payload.callId ||
    payload.callSid ||
    payload.id ||
    ''
  );
};

const getAssistantIdentifier = (payload) =>
  getMessagePayload(payload).assistant?.id ||
  getCallDetails(payload).assistantId ||
  payload.assistant?.id ||
  payload.assistantId ||
  '';

const getCallerNumber = (payload) =>
  getCustomerDetails(payload).number ||
  getCallDetails(payload).phoneNumber ||
  getCallDetails(payload).phone ||
  getMessagePayload(payload).phoneNumber ||
  payload.phoneNumber ||
  'Unknown Caller';

const getCallerName = (payload) =>
  getCustomerDetails(payload).name ||
  payload.callerName ||
  '';

const getTranscriptChunk = (payload) => {
  const message = getMessagePayload(payload);

  return (
    message.transcript ||
    message.artifact?.transcript ||
    message.text ||
    payload.transcript ||
    payload.text ||
    ''
  );
};

const getRecordingUrl = (payload) => {
  const message = getMessagePayload(payload);

  return (
    message.artifact?.recording?.mono?.url ||
    message.artifact?.recording?.stereo?.url ||
    message.recordingUrl ||
    payload.recordingUrl ||
    ''
  );
};

const getDurationSeconds = (payload) => {
  const message = getMessagePayload(payload);
  const call = getCallDetails(payload);
  const durationMs =
    message.durationMs ||
    call.durationMs ||
    payload.durationMs ||
    0;

  return (
    message.durationSeconds ||
    call.durationSeconds ||
    payload.durationSeconds ||
    (durationMs ? Math.round(durationMs / 1000) : 0) ||
    0
  );
};

const getComputedDurationSeconds = ({ startedAt, endedAt }) => {
  if (!startedAt || !endedAt) {
    return 0;
  }

  return Math.max(0, Math.round((new Date(endedAt) - new Date(startedAt)) / 1000));
};

const getEndedReason = (payload) =>
  getMessagePayload(payload).endedReason ||
  getCallDetails(payload).endedReason ||
  payload.endedReason ||
  '';

const getAnalysisSummary = (payload) =>
  getMessagePayload(payload).summary ||
  getMessagePayload(payload).artifact?.summary ||
  getMessagePayload(payload).analysis?.summary ||
  getMessagePayload(payload).artifact?.analysis?.summary ||
  getCallDetails(payload).summary ||
  getCallDetails(payload).analysis?.summary ||
  getCallDetails(payload).artifact?.summary ||
  payload.summary ||
  payload.artifact?.summary ||
  payload.analysis?.summary ||
  payload.artifact?.analysis?.summary ||
  '';

const getAnalysisSentiment = (payload) =>
  getMessagePayload(payload).sentiment ||
  getMessagePayload(payload).artifact?.sentiment ||
  getMessagePayload(payload).analysis?.sentiment ||
  getMessagePayload(payload).artifact?.analysis?.sentiment ||
  getCallDetails(payload).sentiment ||
  getCallDetails(payload).analysis?.sentiment ||
  payload.sentiment ||
  payload.artifact?.sentiment ||
  payload.analysis?.sentiment ||
  payload.artifact?.analysis?.sentiment ||
  'unknown';

const buildFallbackSummary = (transcript, existingCallLog = null) => {
  const trimmedTranscript = String(transcript || '').trim();

  if (trimmedTranscript) {
    return trimmedTranscript.length > 300
      ? `${trimmedTranscript.slice(0, 297)}...`
      : trimmedTranscript;
  }

  if (existingCallLog?.bookingOutcome && existingCallLog.bookingOutcome !== 'none') {
    return `Call completed. Booking outcome: ${existingCallLog.bookingOutcome}.`;
  }

  if (existingCallLog?.transferOutcome && existingCallLog.transferOutcome !== 'none') {
    return `Call completed. Transfer outcome: ${existingCallLog.transferOutcome}.`;
  }

  return 'Call completed. No transcript summary was provided by Vapi.';
};

const getProviderStatus = (payload) =>
  getMessagePayload(payload).status ||
  getCallDetails(payload).status ||
  payload.status ||
  '';

const mapProviderStatusToInternalStatus = (providerStatus, fallbackStatus = 'active') => {
  switch (providerStatus) {
    case 'scheduled':
    case 'queued':
      return 'queued';
    case 'ringing':
      return 'ringing';
    case 'in-progress':
    case 'active':
      return 'active';
    case 'forwarding':
      return 'transferred';
    case 'ended':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return fallbackStatus;
  }
};

const getDerivedCallStatus = (payload, fallbackStatus = 'active') => {
  const messageType = getMessageType(payload);
  const callStatus = getProviderStatus(payload);

  if (['call-ended', 'hang', 'end-of-call-report'].includes(messageType)) {
    return callStatus === 'failed' ? 'failed' : 'completed';
  }

  return mapProviderStatusToInternalStatus(callStatus, fallbackStatus);
};

const logProcessedEvent = (eventType, callLog) => {
  logger.info(
    `[VAPI EVENT] ${eventType} | callId=${callLog?.vapiCallId || callLog?.callSid || 'unknown'} | docId=${callLog?._id?.toString?.() || 'unknown'}`
  );
};

const logIgnoredEvent = (eventType, payload) => {
  logger.info(`[VAPI] ignored ${eventType} | callId=${getCallIdentifier(payload) || 'unknown'}`);
};

const isTerminalStatus = (status) => ['completed', 'failed'].includes(status);

const resolveNextInternalStatus = ({ existingStatus, incomingStatus }) => {
  if (!incomingStatus) {
    return existingStatus || 'active';
  }

  if (isTerminalStatus(existingStatus) && !isTerminalStatus(incomingStatus)) {
    return existingStatus;
  }

  return incomingStatus;
};

const finalizeCompletedCallFromExistingLog = async (payload, fallbackStatus = 'completed') => {
  const callSid = getCallIdentifier(payload);
  const existingCallLog =
    (await CallLog.findOne({ vapiCallId: callSid })) ||
    (await CallLog.findOne({ callSid }));

  if (!existingCallLog) {
    logger.info(`[CALL FOUND] no | callId=${callSid}`);
    return null;
  }

  logger.info(`[CALL FOUND] yes | callId=${callSid} | docId=${existingCallLog._id.toString()}`);

  const transcriptArtifacts = extractTranscriptArtifacts(payload);
  const transcriptEntries = mergeTranscriptEntries(
    existingCallLog.transcriptEntries || [],
    transcriptArtifacts.entries
  );
  const transcript =
    transcriptEntries.length
      ? stringifyTranscriptEntries(transcriptEntries)
      : appendTranscript(
          existingCallLog.transcript,
          transcriptArtifacts.text || getTranscriptChunk(payload)
        );
  const startedAt =
    existingCallLog.startedAt ||
    existingCallLog.createdAt ||
    getCallDetails(payload).startedAt ||
    getMessagePayload(payload).startedAt ||
    null;
  const endedAt =
    getMessagePayload(payload).endedAt ||
    getCallDetails(payload).endedAt ||
    existingCallLog.endedAt ||
    new Date();
  const durationSeconds =
    getComputedDurationSeconds({ startedAt, endedAt }) ||
    getDurationSeconds(payload) ||
    existingCallLog.durationSeconds ||
    0;
  const summaryFromPayload = getAnalysisSummary(payload);
  const sentimentFromPayload = getAnalysisSentiment(payload);
  const [summary, sentiment] = await Promise.all([
    existingCallLog.summary || !transcript
      ? Promise.resolve(existingCallLog.summary || buildFallbackSummary(transcript, existingCallLog))
      : summaryFromPayload
          ? Promise.resolve(summaryFromPayload)
          : withRetry(() => summarizeTranscript(transcript), { operationName: 'openai-summary' }).catch((error) => {
              logger.warn(`[VAPI] summary fallback failed | callId=${callSid} | error=${error.message}`);
              return buildFallbackSummary(transcript, existingCallLog);
            }),
    existingCallLog.sentiment && existingCallLog.sentiment !== 'unknown'
      ? Promise.resolve(existingCallLog.sentiment)
      : sentimentFromPayload && sentimentFromPayload !== 'unknown'
        ? Promise.resolve(sentimentFromPayload)
        : transcript
          ? withRetry(() => analyzeSentiment(transcript), { operationName: 'openai-sentiment' }).catch((error) => {
              logger.warn(`[VAPI] sentiment fallback failed | callId=${callSid} | error=${error.message}`);
              return 'unknown';
            })
          : Promise.resolve('unknown')
  ]);

  return upsertCallLogForEvent(payload, {
    status: fallbackStatus,
    transcriptEntries,
    transcript,
    summary,
    sentiment,
    durationSeconds,
    startedAt,
    endedAt,
    endedReason: getEndedReason(payload) || existingCallLog.endedReason || '',
    recordingUrl: getRecordingUrl(payload) || existingCallLog.recordingUrl || '',
    providerStatus: getProviderStatus(payload) || existingCallLog.providerStatus || 'ended'
  });
};

const normalizeTranscriptEntry = (entry, index = 0) => {
  if (!entry) {
    return null;
  }

  const speaker = entry.role || entry.speaker || entry.speakerLabel || 'unknown';
  const text = entry.message || entry.text || entry.content || entry.transcript || '';

  if (!String(text || '').trim()) {
    return null;
  }

  return {
    speaker,
    text: String(text).trim(),
    timestamp:
      entry.timestamp ||
      entry.time ||
      entry.secondsFromStart ||
      entry.endTime ||
      index
  };
};

const mergeTranscriptEntries = (existingEntries = [], incomingEntries = []) => {
  const merged = [...existingEntries];
  const seen = new Set(
    existingEntries.map((entry) =>
      JSON.stringify([entry.speaker, entry.text, entry.timestamp ?? null])
    )
  );

  for (const entry of incomingEntries) {
    const normalizedEntry = normalizeTranscriptEntry(entry);
    if (!normalizedEntry) {
      continue;
    }

    const key = JSON.stringify([
      normalizedEntry.speaker,
      normalizedEntry.text,
      normalizedEntry.timestamp ?? null
    ]);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(normalizedEntry);
  }

  return merged;
};

const stringifyTranscriptEntries = (entries = []) =>
  entries
    .map((entry) => `${entry.speaker}: ${entry.text}`.trim())
    .filter(Boolean)
    .join('\n');

const extractTranscriptArtifacts = (payload) => {
  const message = getMessagePayload(payload);
  const artifact = message.artifact || payload.artifact || {};
  const transcriptSource = artifact.transcript || message.transcript || payload.transcript || '';
  const messagesSource = artifact.messages || message.messages || payload.messages || [];

  const transcriptEntries = [];

  if (Array.isArray(messagesSource)) {
    transcriptEntries.push(...messagesSource);
  }

  if (Array.isArray(transcriptSource)) {
    transcriptEntries.push(...transcriptSource);
  }

  const normalizedEntries = transcriptEntries
    .map((entry, index) => normalizeTranscriptEntry(entry, index))
    .filter(Boolean);

  const transcriptText =
    typeof transcriptSource === 'string'
      ? transcriptSource.trim()
      : stringifyTranscriptEntries(normalizedEntries);

  return {
    entries: normalizedEntries,
    text: transcriptText
  };
};

const appendTranscript = (existingTranscript, nextChunk) => {
  const trimmedNextChunk = String(nextChunk || '').trim();

  if (!trimmedNextChunk) {
    return existingTranscript || '';
  }

  const currentTranscript = String(existingTranscript || '').trim();
  if (!currentTranscript) {
    return trimmedNextChunk;
  }

  if (currentTranscript.includes(trimmedNextChunk)) {
    return currentTranscript;
  }

  return `${currentTranscript}\n${trimmedNextChunk}`.trim();
};

const buildToolResult = ({ toolCallId, result }) => ({
  ...(toolCallId ? { toolCallId } : {}),
  result
});

const slotTimeFormatter = new Intl.DateTimeFormat('en-PK', {
  timeZone: 'Asia/Karachi',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

const slotDateTimeFormatter = new Intl.DateTimeFormat('en-PK', {
  timeZone: 'Asia/Karachi',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

const formatSlotLabel = (slot, includeDate = false) =>
  (includeDate ? slotDateTimeFormatter : slotTimeFormatter).format(new Date(slot.start));

const appointmentDateTimeFormatter = new Intl.DateTimeFormat('en-PK', {
  timeZone: 'Asia/Karachi',
  weekday: 'long',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

const formatAppointmentDateTime = (value) =>
  appointmentDateTimeFormatter.format(new Date(value));

const normalizePhoneNumber = (value) => {
  if (!value) {
    return value;
  }

  const sanitized = String(value).replace(/\s+/g, '');

  if (sanitized.startsWith('+')) {
    return sanitized;
  }

  if (/^92\d{10}$/.test(sanitized)) {
    return `+${sanitized}`;
  }

  if (/^0\d{10}$/.test(sanitized)) {
    return `+92${sanitized.slice(1)}`;
  }

  return sanitized;
};

const buildAvailabilitySpokenSummary = (availability) => {
  if (!availability.length) {
    return 'No appointments are available for that time. Would you like me to check another day?';
  }

  const uniqueDays = new Set(
    availability.map((slot) => new Date(slot.start).toISOString().slice(0, 10))
  ).size;
  const includeDate = uniqueDays > 1;
  const spokenSlots =
    uniqueDays === 1
      ? availability.map((slot) => formatSlotLabel(slot, false))
      : availability.slice(0, 6).map((slot) => formatSlotLabel(slot, includeDate));

  if (uniqueDays === 1) {
    return `Available slots are ${spokenSlots.join(', ')}. Which one works for you?`;
  }

  const remainingCount = availability.length - spokenSlots.length;
  return remainingCount > 0
    ? `Available slots start at ${spokenSlots.join(', ')}, with ${remainingCount} more options available. Which day works for you?`
    : `Available slots are ${spokenSlots.join(', ')}. Which one works for you?`;
};

const normalizeToolParameters = (parameters) => {
  if (!parameters) {
    return {};
  }

  if (typeof parameters === 'string') {
    try {
      return JSON.parse(parameters);
    } catch {
      return {};
    }
  }

  return parameters;
};

const extractFunctionName = (payload) =>
  payload?.functionCall?.name ||
  payload?.toolCall?.name ||
  payload?.message?.toolCalls?.[0]?.function?.name ||
  payload?.message?.toolCallList?.[0]?.function?.name ||
  payload?.message?.functionCall?.name ||
  payload?.name ||
  payload?.functionName ||
  null;

const extractParameters = (payload) =>
  normalizeToolParameters(
    payload?.functionCall?.parameters ||
      payload?.functionCall?.arguments ||
      payload?.toolCall?.parameters ||
      payload?.toolCall?.arguments ||
      payload?.message?.toolCalls?.[0]?.function?.arguments ||
      payload?.message?.toolCalls?.[0]?.parameters ||
      payload?.message?.toolCallList?.[0]?.function?.arguments ||
      payload?.message?.toolCallList?.[0]?.parameters ||
      payload?.message?.functionCall?.parameters ||
      payload?.message?.functionCall?.arguments ||
      payload?.parameters ||
      payload?.arguments
  );

const getToolCalls = (payload) => {
  const message = getMessagePayload(payload);

  return message.toolCalls?.map((toolCall) => ({
    id: toolCall.id || toolCall.toolCallId,
    name:
      toolCall.function?.name ||
      toolCall.name ||
      toolCall.functionName,
    parameters: normalizeToolParameters(
      toolCall.function?.arguments ||
      toolCall.arguments ||
      toolCall.parameters
    )
  })) ||
    message.toolCallList?.map((toolCall) => ({
      id: toolCall.id || toolCall.toolCallId,
      name:
        toolCall.function?.name ||
        toolCall.name ||
        toolCall.functionName,
      parameters: normalizeToolParameters(
        toolCall.function?.arguments ||
        toolCall.arguments ||
        toolCall.parameters
      )
    })) ||
    (message.functionCall
      ? [
          {
            id: message.functionCall.id,
            name: message.functionCall.name || message.functionCall.functionName,
            parameters: normalizeToolParameters(
              message.functionCall.parameters || message.functionCall.arguments
            )
          }
        ]
      : payload.functionCall
        ? [
            {
              id: payload.functionCall.id,
              name: payload.functionCall.name || payload.functionCall.functionName,
              parameters: normalizeToolParameters(
                payload.functionCall.parameters || payload.functionCall.arguments
              )
            }
          ]
      : payload.toolCall
        ? [
            {
              id: payload.toolCall.id || payload.toolCall.toolCallId,
              name:
                payload.toolCall.function?.name ||
                payload.toolCall.name ||
                payload.toolCall.functionName,
              parameters: normalizeToolParameters(
                payload.toolCall.function?.arguments ||
                payload.toolCall.arguments ||
                payload.toolCall.parameters
              )
            }
          ]
        : payload.name || payload.functionName
          ? [
              {
                id: payload.id || payload.toolCallId,
                name: payload.name || payload.functionName,
                parameters: normalizeToolParameters(
                  payload.parameters || payload.arguments
                )
              }
            ]
          : payload.patientName && payload.phone && payload.appointmentDate
            ? [
                {
                  id: payload.id || payload.toolCallId,
                  name: 'bookAppointment',
                  parameters: normalizeToolParameters({
                    patientName: payload.patientName,
                    phone: payload.phone,
                    appointmentDate: payload.appointmentDate,
                    reason: payload.reason,
                    email: payload.email,
                    notes: payload.notes,
                    durationMinutes: payload.durationMinutes
                  })
                }
              ]
          : (payload.appointmentId || payload.phone) &&
            !payload.newAppointmentDate &&
            !payload.appointmentDate &&
            !payload.patientName &&
            !payload.dateQuery &&
            !payload.question
            ? [
                {
                  id: payload.id || payload.toolCallId,
                  name: 'cancelAppointment',
                  parameters: normalizeToolParameters({
                    appointmentId: payload.appointmentId,
                    phone: payload.phone,
                    cancellationReason: payload.cancellationReason || payload.reason
                  })
                }
              ]
          : payload.phone && payload.newAppointmentDate
            ? [
                {
                  id: payload.id || payload.toolCallId,
                  name: 'rescheduleAppointment',
                  parameters: normalizeToolParameters({
                    phone: payload.phone,
                    newAppointmentDate: payload.newAppointmentDate,
                    durationMinutes: payload.durationMinutes,
                    reason: payload.reason
                  })
                }
              ]
          : payload.dateQuery || payload.start || payload.end
            ? [
                {
                  id: payload.id || payload.toolCallId,
                  name: 'checkAvailability',
                  parameters: normalizeToolParameters({
                    dateQuery: payload.dateQuery,
                    start: payload.start,
                    end: payload.end
                  })
                }
              ]
            : payload.question
              ? [
                  {
                    id: payload.id || payload.toolCallId,
                    name: 'answerFAQ',
                    parameters: normalizeToolParameters({
                      question: payload.question
                    })
                  }
                ]
          : []);
};

export const inspectVapiRequest = (payload) => {
  const message = getMessagePayload(payload);
  const toolCalls = getToolCalls(payload);
  const extractedFunctionName = extractFunctionName(payload);
  const extractedParameters = extractParameters(payload);

  let format = 'unknown';

  if (payload.patientName && payload.phone && payload.appointmentDate) {
    format = 'direct-book-appointment-request';
  } else if (
    (payload.appointmentId || payload.phone) &&
    !payload.newAppointmentDate &&
    !payload.appointmentDate &&
    !payload.patientName &&
    !payload.dateQuery &&
    !payload.question
  ) {
    format = 'direct-cancel-appointment-request';
  } else if (payload.phone && payload.newAppointmentDate) {
    format = 'direct-reschedule-appointment-request';
  } else if (payload.dateQuery || payload.start || payload.end) {
    format = 'tool-tester-direct-request';
  } else if (payload.question) {
    format = 'direct-faq-request';
  } else if (payload.toolCall) {
    format = 'legacy-tool-call';
  } else if (message.toolCalls?.length) {
    format = 'new-vapi-tool-call';
  } else if (message.toolCallList?.length) {
    format = 'wrapped-tool-call';
  } else if (message.functionCall || payload.functionCall) {
    format = 'legacy-function-call';
  } else if (payload.name || payload.functionName) {
    format = 'named-direct-request';
  } else if (payload.type || message.type) {
    format = 'event-webhook';
  }

  return {
    format,
    toolCalls,
    toolName: toolCalls[0]?.name || extractedFunctionName || null,
    toolCallId: toolCalls[0]?.id || null,
    parameters: toolCalls[0]?.parameters || extractedParameters || {}
  };
};

const normalizeCustomToolResult = (toolName, result) => {
  switch (toolName) {
    case 'checkAvailability':
      return {
        success: result.hasAvailability,
        message: result.spokenSummary
      };

    case 'answerFAQ':
      return {
        success: result.success,
        spokenAnswer: result.spokenAnswer
      };

    case 'bookAppointment':
      return {
        success: result.success,
        appointmentId: result.appointmentId,
        appointmentDate: result.appointmentDate,
        calendarEventCreated: result.calendarEventCreated,
        notificationSent: result.notificationSent,
        notificationError: result.notificationError,
        message: result.spokenSummary || 'Appointment booked successfully.'
      };

    case 'cancelAppointment':
      return {
        success: result.success,
        appointmentId: result.appointmentId,
        calendarEventCreated: result.calendarEventCreated,
        notificationSent: result.notificationSent,
        notificationError: result.notificationError,
        message: 'Your appointment has been cancelled successfully.'
      };

    case 'rescheduleAppointment':
      return {
        success: result.success,
        appointmentId: result.appointmentId,
        appointmentDate: result.appointmentDate,
        notificationSent: result.notificationSent,
        notificationError: result.notificationError,
        message: result.spokenSummary || 'Your appointment has been rescheduled successfully.'
      };

    case 'transferToHuman':
      return {
        success: result.success,
        message: 'Connecting you to a human staff member now.'
      };

    default:
      return result;
  }
};

export const isDirectCustomToolRequest = (payload) => {
  const { format } = inspectVapiRequest(payload);

  return [
    'tool-tester-direct-request',
    'named-direct-request',
    'direct-book-appointment-request',
    'direct-cancel-appointment-request',
    'direct-reschedule-appointment-request',
    'legacy-tool-call',
    'direct-faq-request'
  ].includes(format);
};

export const createCallStartedLog = async (payload) => {
  const callSid = getCallIdentifier(payload);

  const callLog = await upsertCallLogForEvent(payload, {
    status: 'active',
    startedAt: getCallDetails(payload).startedAt || getMessagePayload(payload).startedAt || new Date()
  });

  logger.info(`[CALL START] callId=${callLog.callSid} | phone=${callLog.phone} | status=${callLog.status}`);

  return callLog;
};

export const upsertCallLogForEvent = async (payload, overrides = {}) => {
  const message = getMessagePayload(payload);
  const call = getCallDetails(payload);
  const eventType = getMessageType(payload) || 'unknown';
  const callSid = getCallIdentifier(payload);

  if (!callSid) {
    logger.info(`[VAPI] skipped upsert ${eventType} | callId=unknown`);
    return null;
  }

  const existingCallLog =
    (await CallLog.findOne({ vapiCallId: callSid })) ||
    (await CallLog.findOne({ callSid }));

  const callerName =
    getCallerName(payload) ||
    existingCallLog?.callerName ||
    (getCallerNumber(payload) === 'Unknown Caller' ? 'Unknown Caller' : '');
  const phone = getCallerNumber(payload) || existingCallLog?.phone || 'Unknown Caller';
  const transcriptArtifacts = extractTranscriptArtifacts(payload);
  const existingTranscriptEntries = existingCallLog?.transcriptEntries || [];
  const nextTranscriptEntries =
    overrides.transcriptEntries ??
    mergeTranscriptEntries(existingTranscriptEntries, transcriptArtifacts.entries);
  const nextTranscript =
    overrides.transcript ??
    (nextTranscriptEntries.length
      ? stringifyTranscriptEntries(nextTranscriptEntries)
      : appendTranscript(existingCallLog?.transcript, transcriptArtifacts.text || getTranscriptChunk(payload)));
  const nextRecordingUrl =
    overrides.recordingUrl ??
    (getRecordingUrl(payload) ||
      existingCallLog?.recordingUrl ||
      '');
  const startedAt =
    existingCallLog?.startedAt ??
    overrides.startedAt ??
    call.startedAt ??
    message.startedAt ??
    (eventType === 'call-started' ? new Date() : null);
  const endedAt =
    overrides.endedAt ??
    message.endedAt ??
    call.endedAt ??
    existingCallLog?.endedAt ??
    null;
  const providedDurationSeconds =
    overrides.durationSeconds ??
    (getDurationSeconds(payload) ||
      existingCallLog?.durationSeconds ||
      0);
  const durationSeconds =
    getComputedDurationSeconds({ startedAt, endedAt }) ||
    providedDurationSeconds;
  const incomingStatus = overrides.status ?? getDerivedCallStatus(payload, existingCallLog?.status || 'active');
  const nextStatus = resolveNextInternalStatus({
    existingStatus: existingCallLog?.status || '',
    incomingStatus
  });

  const callLog = await CallLog.findOneAndUpdate(
    { vapiCallId: callSid },
    {
      $set: {
        callerName,
        patientName: overrides.patientName ?? callerName,
        phone,
        vapiCallId: callSid,
        callSid,
        assistantId:
          overrides.assistantId ??
          (getAssistantIdentifier(payload) || existingCallLog?.assistantId || ''),
        status: nextStatus,
        providerStatus:
          overrides.providerStatus ??
          (getProviderStatus(payload) || existingCallLog?.providerStatus || ''),
        transcript: nextTranscript,
        transcriptEntries: nextTranscriptEntries,
        recordingUrl: nextRecordingUrl,
        durationSeconds,
        startedAt,
        endedAt,
        endedReason:
          overrides.endedReason ??
          getEndedReason(payload) ??
          existingCallLog?.endedReason ??
          '',
        summary:
          overrides.summary ??
          (getAnalysisSummary(payload) || existingCallLog?.summary || ''),
        sentiment:
          overrides.sentiment ??
          (getAnalysisSentiment(payload) || existingCallLog?.sentiment || 'unknown'),
        metadata: payload,
        lastEventType: eventType
      },
      $addToSet: {
        receivedEventTypes: eventType
      }
    },
    {
      new: true,
      upsert: true
    }
  );

  logger.info(`[CALL UPDATED] ${eventType} | callId=${callSid} | phone=${phone} | docId=${callLog._id.toString()}`);
  logger.info(
    `[TRANSCRIPT LENGTH] ${callSid} | ${callLog.transcript?.length || 0}`
  );
  logger.info(
    `[SUMMARY LENGTH] ${callSid} | ${callLog.summary?.length || 0}`
  );
  logger.info(
    `[DURATION] ${callSid} | ${callLog.durationSeconds || 0}s`
  );
  if (env.debugVapi) {
    logger.info(
      `[VAPI][DEBUG] state status=${callLog.status} providerStatus=${callLog.providerStatus} startedAt=${callLog.startedAt} endedAt=${callLog.endedAt} durationSeconds=${callLog.durationSeconds}`
    );
  }

  return callLog;
};

export const appendTranscriptToCallLog = async (payload) => {
  const callSid = getCallIdentifier(payload);
  const transcriptArtifacts = extractTranscriptArtifacts(payload);
  const transcriptChunk = transcriptArtifacts.text || getTranscriptChunk(payload);

  const existingCallLog =
    (await CallLog.findOne({ vapiCallId: callSid })) ||
    (await CallLog.findOne({ callSid }));

  const nextTranscriptEntries = mergeTranscriptEntries(
    existingCallLog?.transcriptEntries || [],
    transcriptArtifacts.entries
  );
  const nextTranscript =
    nextTranscriptEntries.length
      ? stringifyTranscriptEntries(nextTranscriptEntries)
      : appendTranscript(existingCallLog?.transcript, transcriptChunk);
  const callLog = await upsertCallLogForEvent(payload, {
    transcriptEntries: nextTranscriptEntries,
    transcript: nextTranscript,
    status: existingCallLog?.status === 'transferred' ? 'transferred' : 'active'
  });

  logger.info(
    `[VAPI] transcript appended | callId=${callLog?.callSid || 'unknown'} | transcriptLength=${callLog?.transcript?.length || 0}`
  );

  return callLog;
};

export const markCallEnded = async (payload) => {
  const call = getCallDetails(payload);
  const callLog = await finalizeCompletedCallFromExistingLog(
    payload,
    call.status === 'failed' ? 'failed' : 'completed'
  );

  logger.info(
    `[CALL END] callId=${callLog?.callSid || 'unknown'} | status=${callLog?.status || 'unknown'} | durationSeconds=${callLog?.durationSeconds || 0}`
  );

  return callLog;
};

export const finalizeCallReport = async (payload) => {
  const message = getMessagePayload(payload);
  const call = getCallDetails(payload);
  const callSid = getCallIdentifier(payload);
  const existingCallLog =
    (await CallLog.findOne({ vapiCallId: callSid })) ||
    (await CallLog.findOne({ callSid }));
  logger.info(
    `[CALL FOUND] ${existingCallLog ? 'yes' : 'no'} | callId=${callSid}${existingCallLog ? ` | docId=${existingCallLog._id.toString()}` : ''}`
  );
  const transcriptArtifacts = extractTranscriptArtifacts(payload);
  const transcriptEntries = mergeTranscriptEntries(
    existingCallLog?.transcriptEntries || [],
    transcriptArtifacts.entries
  );
  const transcript =
    transcriptEntries.length
      ? stringifyTranscriptEntries(transcriptEntries)
      : appendTranscript(
          existingCallLog?.transcript,
          transcriptArtifacts.text || message.artifact?.transcript || message.transcript || payload.transcript || ''
        );
  const startedAt =
    existingCallLog?.startedAt ||
    existingCallLog?.createdAt ||
    message.startedAt ||
    call.startedAt ||
    null;
  const endedAt =
    message.endedAt ||
    call.endedAt ||
    existingCallLog?.endedAt ||
    new Date();
  const durationSeconds =
    getComputedDurationSeconds({ startedAt, endedAt }) ||
    getDurationSeconds(payload) ||
    existingCallLog?.durationSeconds ||
    0;
  const summaryFromPayload = getAnalysisSummary(payload);
  const sentimentFromPayload = getAnalysisSentiment(payload);
  const [summary, sentiment] = await Promise.all([
    summaryFromPayload
      ? Promise.resolve(summaryFromPayload)
      : transcript
        ? withRetry(() => summarizeTranscript(transcript), { operationName: 'openai-summary' }).catch((error) => {
            logger.warn(`[VAPI] summary fallback failed | callId=${callSid} | error=${error.message}`);
            return buildFallbackSummary(transcript, existingCallLog);
          })
        : Promise.resolve(buildFallbackSummary(transcript, existingCallLog)),
    sentimentFromPayload && sentimentFromPayload !== 'unknown'
      ? Promise.resolve(sentimentFromPayload)
      : withRetry(() => analyzeSentiment(transcript), { operationName: 'openai-sentiment' }).catch((error) => {
          logger.warn(`[VAPI] sentiment fallback failed | callId=${callSid} | error=${error.message}`);
          return 'unknown';
        })
  ]);

  const callLog = await upsertCallLogForEvent(payload, {
    status: call.status === 'failed' ? 'failed' : 'completed',
    transcriptEntries,
    transcript,
    summary,
    sentiment,
    durationSeconds,
    startedAt,
    endedAt,
    endedReason: getEndedReason(payload),
    recordingUrl: getRecordingUrl(payload),
    providerStatus: getProviderStatus(payload)
  });

  logger.info(
    `[CALL END] report saved | callId=${callLog?.callSid || 'unknown'} | durationSeconds=${callLog?.durationSeconds || 0} | status=${callLog?.status || 'unknown'} | recording=${callLog?.recordingUrl ? 'yes' : 'no'}`
  );

  return callLog;
};

const executeClinicFunction = async ({ name, parameters, call }) => {
  switch (name) {
    case 'checkAvailability': {
      const availability = await getAvailability({
        dateQuery:
          parameters.dateQuery ||
          (!parameters.start && !parameters.end ? 'earliest available' : undefined),
        start: parameters.start,
        end: parameters.end
      });
      return {
        success: true,
        hasAvailability: availability.length > 0,
        availableSlots: availability,
        spokenSummary: buildAvailabilitySpokenSummary(availability)
      };
    }

    case 'bookAppointment': {
      const normalizedAppointmentDate = parseAppointmentDateToIso(parameters.appointmentDate);
      logger.info(
        `[BOOKING] bookAppointment | phone=${normalizePhoneNumber(parameters.phone)} | appointmentDate=${normalizedAppointmentDate}`
      );
      const appointment = await createAppointment({
        ...parameters,
        phone: normalizePhoneNumber(parameters.phone),
        appointmentDate: normalizedAppointmentDate,
        source: 'phone'
      });
      return {
        success: true,
        appointmentId: appointment._id.toString(),
        appointmentDate: appointment.appointmentDate,
        patientName: appointment.patient?.fullName,
        calendarEventCreated: appointment.calendarEventCreated,
        notificationSent: appointment.notificationSent,
        notificationError: appointment.notificationError,
        spokenDateTime: appointment.spokenDateTime,
        spokenSummary: `Appointment booked successfully for ${appointment.spokenDateTime}.`
      };
    }

    case 'cancelAppointment': {
      const appointment = await cancelAppointment({
        ...parameters,
        phone: normalizePhoneNumber(parameters.phone)
      });
      return {
        success: true,
        appointmentId: appointment._id.toString(),
        status: appointment.status,
        calendarEventCreated: appointment.calendarEventCreated,
        notificationSent: appointment.notificationSent,
        notificationError: appointment.notificationError,
        spokenSummary: 'Your appointment has been cancelled.'
      };
    }

    case 'rescheduleAppointment': {
      const appointment = await rescheduleAppointment({
        ...parameters,
        phone: normalizePhoneNumber(parameters.phone)
      });
      return {
        success: true,
        appointmentId: appointment._id.toString(),
        appointmentDate: appointment.appointmentDate,
        status: 'rescheduled',
        calendarEventCreated: appointment.calendarEventCreated,
        notificationSent: appointment.notificationSent,
        notificationError: appointment.notificationError,
        spokenDateTime: appointment.spokenDateTime,
        spokenSummary: `Your appointment has been rescheduled to ${appointment.spokenDateTime}.`
      };
    }

    case 'transferToHuman': {
      const clinic = await getClinicConfig();
      if (!clinic.emergencyTransferNumber) {
        throw new ApiError(409, 'Emergency transfer number is not configured');
      }

      return {
        success: true,
        destination: {
          type: 'number',
          number: clinic.emergencyTransferNumber,
          message: 'Connecting you to a clinic staff member now.'
        },
        callId: call.id,
        spokenSummary: 'Connecting you to a human staff member.'
      };
    }

    case 'answerFAQ': {
      const faqResult = await answerFaq(parameters.question);
      return {
        success: true,
        spokenAnswer: faqResult.answer
      };
    }

    default:
      throw new ApiError(400, `Unsupported Vapi function: ${name}`);
  }
};

export const executeDirectVapiToolRequest = async (payload) => {
  const toolCalls = getToolCalls(payload);

  if (!toolCalls.length) {
    throw new ApiError(400, 'No function calls found in Vapi payload');
  }

  if (toolCalls.length > 1) {
    throw new ApiError(400, 'Direct custom tool requests must contain exactly one tool call');
  }

  const [toolCall] = toolCalls;
  logger.info(`[VAPI] direct tool | name=${toolCall.name}`);
  if (env.debugVapi) {
    logger.info(`[VAPI][DEBUG] direct tool params=${JSON.stringify(toolCall.parameters || {})}`);
  }
  const result = await executeClinicFunction({
    name: toolCall.name,
    parameters: toolCall.parameters || {},
    call: getCallDetails(payload)
  });

  const normalizedResult = normalizeCustomToolResult(toolCall.name, result);
  if (env.debugVapi) {
    logger.info(`[VAPI][DEBUG] direct tool result=${JSON.stringify(normalizedResult)}`);
  }

  return normalizedResult;
};

export const executeVapiFunctionCalls = async (payload) => {
  const call = getCallDetails(payload);
  const calls = getToolCalls(payload);

  if (!calls.length) {
    throw new ApiError(400, 'No function calls found in Vapi payload');
  }

  await upsertCallLogForEvent(payload, {
    status: 'active'
  });

  const results = [];

  for (const toolCall of calls) {
    try {
      const result = await executeClinicFunction({
        name: toolCall.name,
        parameters: toolCall.parameters || {},
        call
      });
      const normalizedResult = normalizeCustomToolResult(toolCall.name, result);

      if (toolCall.name === 'transferToHuman') {
        await CallLog.findOneAndUpdate(
          { vapiCallId: getCallIdentifier(payload) },
          {
            status: 'transferred',
            transferOutcome: 'completed',
            lastEventType: getMessageType(payload) || 'tool-calls'
          },
          { new: true }
        );
      }

      if (['bookAppointment', 'cancelAppointment', 'rescheduleAppointment'].includes(toolCall.name)) {
        const appointmentId = result.appointmentId;
        if (appointmentId) {
          await CallLog.findOneAndUpdate(
            { vapiCallId: getCallIdentifier(payload) },
            {
              appointment: appointmentId,
              patientName: result.patientName || undefined,
              bookingOutcome:
                toolCall.name === 'cancelAppointment'
                  ? 'cancelled'
                  : toolCall.name === 'rescheduleAppointment'
                    ? 'rescheduled'
                    : 'booked',
              status:
                toolCall.name === 'cancelAppointment'
                  ? 'cancelled'
                  : toolCall.name === 'rescheduleAppointment'
                    ? 'rescheduled'
                    : 'booked',
              lastEventType: getMessageType(payload) || 'tool-calls'
            },
            { new: true }
          );
        }
      }

      results.push(
        buildToolResult({
          toolCallId: toolCall.id,
          result: normalizedResult
        })
      );
    } catch (error) {
      logger.error(`Vapi function ${toolCall.name} failed: ${error.message}`);

      results.push(
        buildToolResult({
          toolCallId: toolCall.id,
          result: {
            error: error.message
          }
        })
      );
    }
  }

  return { results };
};

export const handleVapiEvent = async (eventTypeOrPayload, maybePayload) => {
  const payload = maybePayload || eventTypeOrPayload;
  const messageType =
    typeof eventTypeOrPayload === 'string'
      ? eventTypeOrPayload
      : getMessageType(payload);
  logger.info(`[VAPI] ${messageType} | callId=${getCallIdentifier(payload) || 'unknown'}`);

  switch (messageType) {
    case 'assistant.started':
    case 'call-started':
      {
        const callLog = await createCallStartedLog(payload);
        logProcessedEvent(messageType, callLog);
        return {
        httpStatus: 200,
        response: {
          success: true,
          event: messageType,
          data: callLog
        }
      };
      }

    case 'assistant.speechStarted':
      {
        const callLog = await upsertCallLogForEvent(payload, {
          status: 'active'
        });
        logProcessedEvent(messageType, callLog);
        return {
          httpStatus: 200,
          response: {
            success: true,
            event: messageType,
            data: callLog
          }
        };
      }

    case 'transcript':
    case 'conversation-update':
      {
        const callLog = await appendTranscriptToCallLog(payload);
        logProcessedEvent(messageType, callLog);
        return {
          httpStatus: 200,
          response: {
            success: true,
            event: messageType,
            data: callLog
          }
        };
      }

    case 'voice-input':
    case 'speech-update':
    case 'model-output':
    case 'user-interrupted':
      {
        const transcriptArtifacts = extractTranscriptArtifacts(payload);
        const transcriptChunk = transcriptArtifacts.text || getTranscriptChunk(payload);
        const callLog =
          transcriptArtifacts.entries.length || transcriptChunk
            ? await appendTranscriptToCallLog(payload)
            : await upsertCallLogForEvent(payload, {
                status: getDerivedCallStatus(payload, 'active')
              });
        logProcessedEvent(messageType, callLog);
        return {
          httpStatus: 200,
          response: {
            success: true,
            event: messageType,
            data: callLog
          }
        };
      }

    case 'status-update':
      {
        const nextStatus = getDerivedCallStatus(payload, 'active');
        const callLog =
          nextStatus === 'completed' || nextStatus === 'failed'
            ? await finalizeCompletedCallFromExistingLog(payload, nextStatus)
            : await upsertCallLogForEvent(payload, {
                status: nextStatus,
                providerStatus: getProviderStatus(payload)
              });
        logProcessedEvent(messageType, callLog);
        return {
          httpStatus: 200,
        response: {
          success: true,
          event: messageType,
          data: callLog
        }
      };
      }

    case 'function-call':
    case 'tool-calls':
      {
        const toolResults = await executeVapiFunctionCalls(payload);
        logger.info(
          `[VAPI] processed ${messageType} | callId=${getCallIdentifier(payload) || 'unknown'} | toolCalls=${toolResults.results?.length || 0}`
        );
        return {
        httpStatus: 200,
        response: toolResults
      };
      }

    case 'call-ended':
    case 'hang':
      {
        const callLog = await markCallEnded(payload);
        logProcessedEvent(messageType, callLog);
        return {
        httpStatus: 200,
        response: {
          success: true,
          event: messageType,
          data: callLog
        }
      };
      }

    case 'end-of-call-report':
      {
        logger.info(`[END REPORT RECEIVED] ${getCallIdentifier(payload) || 'unknown'}`);
        const callLog = await finalizeCallReport(payload);
        logger.info(`[END REPORT SAVED] ${getCallIdentifier(payload) || 'unknown'}`);
        logProcessedEvent(messageType, callLog);
        return {
        httpStatus: 200,
        response: {
          success: true,
          event: 'end-of-call-report',
          data: callLog
        }
      };
      }

    default:
      logger.info(`Unhandled Vapi event received: ${messageType}`);
      logIgnoredEvent(messageType || 'unknown', payload);
      return {
        httpStatus: 200,
        response: {
          success: true,
          event: messageType || 'unknown',
          message: 'Event acknowledged'
        }
      };
  }
};
