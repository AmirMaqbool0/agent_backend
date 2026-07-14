import {
  createPatient,
  deletePatient,
  getPatientById,
  listPatients,
  searchPatients,
  updatePatient
} from '../services/patient.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const fetchPatients = asyncHandler(async (_req, res) => {
  const patients = await listPatients();
  sendSuccess(res, 200, 'Patients fetched successfully', patients);
});

export const fetchPatientById = asyncHandler(async (req, res) => {
  const patient = await getPatientById(req.params.id);
  sendSuccess(res, 200, 'Patient fetched successfully', patient);
});

export const searchPatientsByQuery = asyncHandler(async (req, res) => {
  const patients = await searchPatients(req.query.q);
  sendSuccess(res, 200, 'Patient search completed successfully', patients);
});

export const createNewPatient = asyncHandler(async (req, res) => {
  const patient = await createPatient(req.body);
  sendSuccess(res, 201, 'Patient created successfully', patient);
});

export const updateExistingPatient = asyncHandler(async (req, res) => {
  const patient = await updatePatient(req.params.id, req.body);
  sendSuccess(res, 200, 'Patient updated successfully', patient);
});

export const removePatient = asyncHandler(async (req, res) => {
  await deletePatient(req.params.id);
  sendSuccess(res, 200, 'Patient deleted successfully');
});

