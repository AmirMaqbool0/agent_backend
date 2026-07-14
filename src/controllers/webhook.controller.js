import {
  executeDirectVapiToolRequest,
  handleVapiEvent,
  inspectVapiRequest,
  isDirectCustomToolRequest
} from '../services/vapi.service.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';

export const handleVapiWebhook = asyncHandler(async (req, res) => {
  const eventType = req.body?.type || req.body?.message?.type || 'unknown';
  const callId =
    req.body?.call?.id ||
    req.body?.message?.call?.id ||
    req.body?.message?.callId ||
    req.body?.callId ||
    'unknown';
  const customerNumber =
    req.body?.call?.customer?.number ||
    req.body?.message?.call?.customer?.number ||
    req.body?.message?.customer?.number ||
    req.body?.customer?.number ||
    req.body?.phoneNumber ||
    'Unknown Caller';
  const assistantId =
    req.body?.assistant?.id ||
    req.body?.message?.assistant?.id ||
    req.body?.call?.assistantId ||
    req.body?.message?.call?.assistantId ||
    'unknown';

  logger.info(`[VAPI] ${eventType} | callId=${callId} | phone=${customerNumber} | assistantId=${assistantId}`);
  if (env.debugVapi) {
    logger.info('[VAPI][DEBUG] FULL VAPI WEBHOOK');
    logger.info(JSON.stringify(req.body, null, 2));
  }
  const inspection = inspectVapiRequest(req.body);
  logger.info(
    `[VAPI] routing format=${inspection.format} tool=${inspection.toolName || 'none'} toolCallId=${inspection.toolCallId || 'none'}`
  );
  if (env.debugVapi) {
    logger.info(`[VAPI][DEBUG] parameters=${JSON.stringify(inspection.parameters || {})}`);
  }

  if (isDirectCustomToolRequest(req.body) && eventType === 'unknown') {
    const result = await executeDirectVapiToolRequest(req.body);
    logger.info(`[VAPI] direct tool response sent | tool=${inspection.toolName || 'unknown'}`);
    if (env.debugVapi) {
      logger.info(`[VAPI][DEBUG] direct response=${JSON.stringify(result)}`);
    }
    return res.status(200).json(result);
  }

  const result = await handleVapiEvent(eventType, req.body);
  logger.info(`[VAPI] event response sent | event=${eventType}`);
  if (env.debugVapi) {
    logger.info(`[VAPI][DEBUG] event response=${JSON.stringify(result.response)}`);
  }
  res.status(result.httpStatus).json(result.response);
});
