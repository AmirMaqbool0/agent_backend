import { Router } from 'express';

import aiRoutes from './ai.routes.js';
import appointmentRoutes from './appointment.routes.js';
import authRoutes from './auth.routes.js';
import callLogRoutes from './callLog.routes.js';
import clinicRoutes from './clinic.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import faqRoutes from './faq.routes.js';
import notificationRoutes from './notification.routes.js';
import patientRoutes from './patient.routes.js';
import testRoutes from './test.routes.js';
import webhookRoutes from './webhook.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/ai', aiRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/calls', callLogRoutes);
router.use('/clinic', clinicRoutes);
router.use('/faq', faqRoutes);
router.use('/notifications', notificationRoutes);
router.use('/patients', patientRoutes);
router.use('/', testRoutes);
router.use('/webhooks', webhookRoutes);

export default router;
