import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { env } from '../config/env.js';
import { CallLog } from '../models/callLog.model.js';
import { listCallLogs } from '../services/callLog.service.js';
import { signedRecordingUrl } from '../services/recordingAccess.service.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const fetchCallLogs = asyncHandler(async (req, res) => {
  const callLogs = await listCallLogs();
  const protocol = env.nodeEnv === 'production' ? 'https' : req.protocol;
  const baseUrl = env.publicBaseUrl || `${protocol}://${req.get('host')}`;
  const calls = callLogs.map((callLog) => ({
    ...callLog.toObject(),
    recordingUrl: callLog.recordingUrl && callLog.vapiCallId
      ? signedRecordingUrl(callLog, baseUrl)
      : callLog.recordingUrl || ''
  }));
  sendSuccess(res, 200, 'Call logs fetched successfully', calls);
});

export const streamCallRecording = asyncHandler(async (req, res) => {
  const callLog = await CallLog.findById(req.params.id).select('vapiCallId recordingUrl');
  if (!callLog?.vapiCallId || !callLog.recordingUrl) {
    throw new ApiError(404, 'Recording is not available for this call');
  }
  if (!env.vapiApiKey) {
    throw new ApiError(503, 'Recording service is not configured');
  }

  // Vapi recording URLs are private. The authenticated API redirects to a fresh,
  // short-lived download URL; stream it without exposing the Vapi key to the browser.
  const upstream = await fetch(
    `${env.vapiBaseUrl.replace(/\/$/, '')}/call/${encodeURIComponent(callLog.vapiCallId)}/mono-recording`,
    {
      headers: {
        Authorization: `Bearer ${env.vapiApiKey}`,
        ...(req.headers.range ? { Range: req.headers.range } : {})
      },
      signal: AbortSignal.timeout(120000)
    }
  );
  if (!upstream.ok || !upstream.body) {
    throw new ApiError(upstream.status === 404 ? 404 : 502, 'Recording could not be loaded from Vapi');
  }

  res.status(upstream.status);
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', 'inline');
  await pipeline(Readable.fromWeb(upstream.body), res);
});

