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
    clinicPhone: {
      type: String,
      default: ''
    },
    address: {
      type: String,
      default: ''
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
    },
    confirmationsEnabled: {
      type: Boolean,
      default: true
    },
    remindersEnabled: {
      type: Boolean,
      default: true
    },
    alertsEnabled: {
      type: Boolean,
      default: true
    },
    assistantPersonality: {
      type: String,
      default: 'Calm and professional'
    },
    aiLanguage: {
      type: String,
      default: 'English'
    },
    responseTone: {
      type: String,
      default: 'Professional'
    },
    escalationRules: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

export const ClinicConfig = mongoose.model('ClinicConfig', clinicConfigSchema);
