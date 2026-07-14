import { getDashboardMetrics } from '../services/dashboard.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const fetchDashboard = asyncHandler(async (_req, res) => {
  const metrics = await getDashboardMetrics();
  sendSuccess(res, 200, 'Dashboard metrics fetched successfully', metrics);
});

