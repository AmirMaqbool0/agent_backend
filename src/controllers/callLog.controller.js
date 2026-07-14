import { listCallLogs } from '../services/callLog.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const fetchCallLogs = asyncHandler(async (_req, res) => {
  const callLogs = await listCallLogs();
  sendSuccess(res, 200, 'Call logs fetched successfully', callLogs);
});

