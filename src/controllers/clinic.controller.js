import {
  getClinicConfig,
  getIntegrationStatus,
  updateClinicConfig
} from '../services/clinic.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getWhatsappWebStatus } from '../services/whatsappWeb.service.js';

export const fetchClinicConfig = asyncHandler(async (_req, res) => {
  const config = await getClinicConfig();
  sendSuccess(res, 200, 'Clinic configuration fetched successfully', config);
});

export const updateClinicSettings = asyncHandler(async (req, res) => {
  const config = await updateClinicConfig(req.body);
  sendSuccess(res, 200, 'Clinic configuration updated successfully', config);
});

export const fetchIntegrationStatus = asyncHandler(async (_req, res) => {
  sendSuccess(res, 200, 'Integration status fetched successfully', getIntegrationStatus());
});

export const fetchWhatsappWebStatus = asyncHandler(async (_req, res) => {
  sendSuccess(res, 200, 'WhatsApp Web status fetched successfully', getWhatsappWebStatus());
});
