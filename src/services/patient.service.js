import { Appointment } from '../models/appointment.model.js';
import { Patient } from '../models/patient.model.js';
import { ApiError } from '../utils/apiError.js';
import { normalizePhoneNumber } from './twilio.service.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PATIENT_FIELDS = ['fullName', 'phone', 'email', 'dateOfBirth', 'notes'];

const pickPatientFields = (payload = {}) =>
  PATIENT_FIELDS.reduce((result, field) => {
    if (payload[field] === undefined) {
      return result;
    }

    if (field === 'phone') {
      result.phone = normalizePhoneNumber(payload.phone);
    } else if (field === 'dateOfBirth') {
      result.dateOfBirth = payload.dateOfBirth || null;
    } else {
      result[field] = payload[field];
    }

    return result;
  }, {});

const attachAppointmentStats = async (patients) => {
  if (!patients.length) {
    return [];
  }

  const stats = await Appointment.aggregate([
    { $match: { patient: { $in: patients.map((patient) => patient._id) } } },
    {
      $group: {
        _id: '$patient',
        appointmentsCount: { $sum: 1 },
        upcomingCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ['$appointmentDate', new Date()] },
                  { $ne: ['$status', 'cancelled'] }
                ]
              },
              1,
              0
            ]
          }
        },
        lastAppointmentAt: { $max: '$appointmentDate' }
      }
    }
  ]);

  const statsByPatient = new Map(stats.map((item) => [String(item._id), item]));

  return patients.map((patient) => {
    const item = statsByPatient.get(String(patient._id));
    return {
      ...patient.toObject(),
      appointmentsCount: item?.appointmentsCount || 0,
      upcomingCount: item?.upcomingCount || 0,
      lastAppointmentAt: item?.lastAppointmentAt || null
    };
  });
};

const assertPhoneAvailable = async (phone, excludeId) => {
  const existingPatient = await Patient.findOne({
    phone,
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  });

  if (existingPatient) {
    throw new ApiError(409, 'A patient with this phone number already exists');
  }
};

export const listPatients = async () =>
  attachAppointmentStats(await Patient.find().sort({ createdAt: -1 }));

export const getPatientById = async (patientId) => {
  const patient = await Patient.findById(patientId);

  if (!patient) {
    throw new ApiError(404, 'Patient not found');
  }

  const [withStats] = await attachAppointmentStats([patient]);
  const appointments = await Appointment.find({ patient: patientId }).sort({ appointmentDate: -1 }).limit(20);

  return { ...withStats, appointments };
};

export const searchPatients = async (query) => {
  const searchTerm = query?.trim();

  if (!searchTerm) {
    return [];
  }

  const pattern = escapeRegex(searchTerm);

  return Patient.find({
    $or: [
      { fullName: { $regex: pattern, $options: 'i' } },
      { phone: { $regex: pattern, $options: 'i' } },
      { email: { $regex: pattern, $options: 'i' } }
    ]
  })
    .sort({ createdAt: -1 })
    .limit(20);
};

export const createPatient = async (payload) => {
  const data = pickPatientFields(payload);

  if (!data.phone) {
    throw new ApiError(400, 'A valid phone number is required');
  }

  await assertPhoneAvailable(data.phone);
  const patient = await Patient.create(data);
  const [withStats] = await attachAppointmentStats([patient]);
  return withStats;
};

export const updatePatient = async (patientId, payload) => {
  const patient = await Patient.findById(patientId);

  if (!patient) {
    throw new ApiError(404, 'Patient not found');
  }

  const data = pickPatientFields(payload);

  if (data.phone !== undefined && !data.phone) {
    throw new ApiError(400, 'A valid phone number is required');
  }

  if (data.phone && data.phone !== patient.phone) {
    await assertPhoneAvailable(data.phone, patientId);
  }

  Object.assign(patient, data);
  await patient.save();

  const [withStats] = await attachAppointmentStats([patient]);
  return withStats;
};

export const deletePatient = async (patientId) => {
  const patient = await Patient.findById(patientId);

  if (!patient) {
    throw new ApiError(404, 'Patient not found');
  }

  const hasActiveAppointments = await Appointment.exists({
    patient: patientId,
    status: { $nin: ['cancelled', 'completed'] }
  });

  if (hasActiveAppointments) {
    throw new ApiError(
      409,
      'This patient still has active appointments. Cancel or complete them before deleting the record.'
    );
  }

  await Appointment.deleteMany({ patient: patientId });
  await patient.deleteOne();
};
