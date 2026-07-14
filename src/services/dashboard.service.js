import { Appointment } from '../models/appointment.model.js';
import { CallLog } from '../models/callLog.model.js';
import { Patient } from '../models/patient.model.js';

export const getDashboardMetrics = async () => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const [todayAppointments, totalPatients, urgentCalls, recentCalls, upcomingAppointments] =
    await Promise.all([
      Appointment.countDocuments({
        appointmentDate: { $gte: startOfDay, $lt: endOfDay },
        status: { $ne: 'cancelled' }
      }),
      Patient.countDocuments(),
      CallLog.countDocuments({ status: 'urgent' }),
      CallLog.find().sort({ createdAt: -1 }).limit(5),
      Appointment.find({
        appointmentDate: { $gte: now },
        status: { $ne: 'cancelled' }
      })
        .populate('patient')
        .sort({ appointmentDate: 1 })
        .limit(5)
    ]);

  return {
    todayAppointments,
    totalPatients,
    urgentCalls,
    recentCalls,
    upcomingAppointments
  };
};

