import { Appointment } from '../models/appointment.model.js';
import { Patient } from '../models/patient.model.js';
import { ApiError } from '../utils/apiError.js';

export const listPatients = async () =>
  Patient.find().sort({ createdAt: -1 });

export const getPatientById = async (patientId) => {
  const patient = await Patient.findById(patientId);

  if (!patient) {
    throw new ApiError(404, 'Patient not found');
  }

  return patient;
};

export const searchPatients = async (query) => {
  const searchTerm = query?.trim();

  if (!searchTerm) {
    return [];
  }

  return Patient.find({
    $or: [
      { fullName: { $regex: searchTerm, $options: 'i' } },
      { phone: { $regex: searchTerm, $options: 'i' } },
      { email: { $regex: searchTerm, $options: 'i' } }
    ]
  })
    .sort({ createdAt: -1 })
    .limit(20);
};

export const createPatient = async (payload) => {
  const existingPatient = await Patient.findOne({ phone: payload.phone });

  if (existingPatient) {
    throw new ApiError(409, 'A patient with this phone number already exists');
  }

  return Patient.create(payload);
};

export const updatePatient = async (patientId, payload) => {
  const patient = await Patient.findById(patientId);

  if (!patient) {
    throw new ApiError(404, 'Patient not found');
  }

  if (payload.phone && payload.phone !== patient.phone) {
    const existingPatient = await Patient.findOne({
      phone: payload.phone,
      _id: { $ne: patientId }
    });

    if (existingPatient) {
      throw new ApiError(409, 'A patient with this phone number already exists');
    }
  }

  Object.assign(patient, payload);
  await patient.save();

  return patient;
};

export const deletePatient = async (patientId) => {
  const patient = await Patient.findById(patientId);

  if (!patient) {
    throw new ApiError(404, 'Patient not found');
  }

  const hasAppointments = await Appointment.exists({ patient: patientId });

  if (hasAppointments) {
    throw new ApiError(
      409,
      'Patient cannot be deleted because linked appointments still exist'
    );
  }

  await patient.deleteOne();
};

