import { ClinicConfig } from '../models/clinicConfig.model.js';

export const getClinicConfig = async () => {
  let config = await ClinicConfig.findOne();

  if (!config) {
    config = await ClinicConfig.create({
      clinicName: 'Clinic Reception',
      timezone: 'UTC',
      workingHours: {
        monday: { start: '09:00', end: '17:00' },
        tuesday: { start: '09:00', end: '17:00' },
        wednesday: { start: '09:00', end: '17:00' },
        thursday: { start: '09:00', end: '17:00' },
        friday: { start: '09:00', end: '17:00' },
        saturday: { start: '10:00', end: '14:00' },
        sunday: { start: '', end: '' }
      }
    });
  }

  return config;
};

export const updateClinicConfig = async (payload) => {
  const config = await getClinicConfig();
  Object.assign(config, payload);
  await config.save();
  return config;
};

