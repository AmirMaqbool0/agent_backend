import mongoose from 'mongoose';

const clinicConfigSchema = new mongoose.Schema(
  {
    clinicName: {
      type: String,
      required: true,
      default: 'Clinic Reception'
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    workingHours: {
      monday: { start: String, end: String },
      tuesday: { start: String, end: String },
      wednesday: { start: String, end: String },
      thursday: { start: String, end: String },
      friday: { start: String, end: String },
      saturday: { start: String, end: String },
      sunday: { start: String, end: String }
    },
    emergencyTransferNumber: {
      type: String,
      default: ''
    },
    appointmentDurationMinutes: {
      type: Number,
      default: 30
    },
    whatsappEnabled: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

export const ClinicConfig = mongoose.model('ClinicConfig', clinicConfigSchema);

