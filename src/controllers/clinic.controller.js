import { getClinicConfig, updateClinicConfig } from '../services/clinic.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const fetchClinicConfig = asyncHandler(async (_req, res) => {
  const config = await getClinicConfig();
  sendSuccess(res, 200, 'Clinic configuration fetched successfully', config);
});

export const updateClinicSettings = asyncHandler(async (req, res) => {
  const config = await updateClinicConfig(req.body);
  sendSuccess(res, 200, 'Clinic configuration updated successfully', config);
});

